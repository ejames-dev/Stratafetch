import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import * as Sentry from "@sentry/node";
import Fastify, { type FastifyRequest } from "fastify";
import { ZodError, z } from "zod";
import {
  apiKeyScopeSchema,
  fetchRequestSchema,
  operationStatusSchema,
  operationTypeSchema,
} from "@stratafetch/contracts";
import type { ApiKeyScope, OperationType } from "@stratafetch/contracts";
import type { AppConfig } from "./config.js";
import { AppError } from "./errors.js";
import { fetchDocument } from "./fetch/service.js";
import type { CollectionService } from "./collections/service.js";
import { registerCollectionRoutes } from "./collections/routes.js";
import type { SurveyService } from "./surveys/service.js";
import { registerSurveyRoutes } from "./surveys/routes.js";
import type { ShapeService } from "./shapes/service.js";
import { registerShapeRoutes } from "./shapes/routes.js";
import { registerSearchRoutes } from "./search/routes.js";
import type { OperationRepository } from "./operations/repository.js";
import type { AuthService } from "./auth/service.js";
import type { RobotsService } from "./robots/service.js";
import type { BraveSearchProvider } from "./providers/brave.js";
import type { OpenAIShapeProvider } from "./providers/openai.js";
import type { DatabasePool } from "./database/pool.js";
import { replayEnvelope } from "./operations/replay.js";
import { buildOpenApi } from "./openapi.js";

export interface AppDependencies {
  pool?: DatabasePool;
  auth?: AuthService;
  operations?: OperationRepository;
  collections?: CollectionService;
  surveys?: SurveyService;
  shapes?: ShapeService;
  robots?: RobotsService;
  brave?: BraveSearchProvider;
  openai?: OpenAIShapeProvider;
  redisReady?: () => Promise<void>;
}
export function buildApp(config: AppConfig, deps: AppDependencies = {}) {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  app.register(cookie);
  // Applied per-route below via `config.rateLimit`; a key-scoped caller can now
  // read, export, and cancel its own operations, so those routes need their own
  // throttle rather than relying on the admin-only routes' obscurity.
  app.register(rateLimit, { global: false });
  // A dashboard session grants full access; a bearer key is authorized per request.
  type Principal = { session: true } | { session: false; token: string };
  // An operation is readable and cancellable by a key holding the scope that
  // matches its type, so a capability key can follow its own async work without
  // the broad admin scope. The scope name for a collection is "collect".
  const operationScopeByType: Record<OperationType, ApiKeyScope> = {
    fetch: "fetch",
    survey: "survey",
    collection: "collect",
    search: "search",
    shape: "shape",
  };
  const authenticate = async (request: FastifyRequest): Promise<Principal> => {
    if (!deps.auth)
      throw new AppError(
        "Authentication is unavailable.",
        503,
        "AUTH_UNAVAILABLE",
      );
    const session = request.cookies.stratafetch_session;
    if (deps.auth.validateSession(session)) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        const origin = request.headers.origin;
        if (origin && new URL(origin).host !== request.headers.host)
          throw new AppError(
            "Cross-origin session request rejected.",
            403,
            "CSRF_REJECTED",
          );
      }
      return { session: true };
    }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer "))
      throw new AppError("Authentication required.", 401, "AUTH_REQUIRED");
    return { session: false, token: authorization.slice(7) };
  };
  const requireScope =
    (scope: ApiKeyScope) => async (request: FastifyRequest) => {
      const principal = await authenticate(request);
      if (principal.session) return;
      if (!(await deps.auth!.authorize(principal.token, scope)))
        throw new AppError(
          "The API key does not have the required scope.",
          403,
          "INSUFFICIENT_SCOPE",
        );
    };
  const authorizeOperation = async (
    principal: Principal,
    type: OperationType,
  ) => {
    if (principal.session) return;
    if (
      !(await deps.auth!.authorize(principal.token, operationScopeByType[type]))
    )
      throw new AppError(
        "The API key does not have the required scope.",
        403,
        "INSUFFICIENT_SCOPE",
      );
  };
  app.get("/health", async () => ({
    status: "ok",
    service: "stratafetch-api",
    version: "1.0.0-alpha.2",
  }));
  app.get("/health/ready", async (_req, reply) => {
    try {
      await deps.pool?.query("SELECT 1");
      await deps.redisReady?.();
      return {
        status: "ready",
        database: Boolean(deps.pool),
        redis: Boolean(deps.redisReady),
        providers: {
          brave: deps.brave?.configured ?? false,
          openai: deps.openai?.configured ?? false,
        },
      };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });
  app.get("/openapi.json", async () => buildOpenApi());
  app.post("/v1/admin/session", async (request, reply) => {
    if (!deps.auth)
      throw new AppError(
        "Authentication is unavailable.",
        503,
        "AUTH_UNAVAILABLE",
      );
    const { token } = z.object({ token: z.string() }).parse(request.body);
    if (!deps.auth.isAdminToken(token))
      throw new AppError("Invalid admin token.", 401, "INVALID_ADMIN_TOKEN");
    const session = deps.auth.createSession();
    reply.setCookie("stratafetch_session", session.value, {
      httpOnly: true,
      sameSite: "strict",
      secure: request.protocol === "https",
      path: "/",
      expires: new Date(session.expires),
    });
    return {
      data: {
        authenticated: true,
        expiresAt: new Date(session.expires).toISOString(),
      },
    };
  });
  app.get("/v1/admin/session", async (request) => ({
    data: {
      authenticated:
        deps.auth?.validateSession(request.cookies.stratafetch_session) ??
        false,
    },
  }));
  app.delete("/v1/admin/session", async (_request, reply) => {
    reply.clearCookie("stratafetch_session", { path: "/" });
    return reply.code(204).send();
  });
  app.get(
    "/v1/admin/keys",
    { preHandler: requireScope("admin") },
    async () => ({ data: await deps.auth!.listKeys() }),
  );
  app.post(
    "/v1/admin/keys",
    { preHandler: requireScope("admin") },
    async (request, reply) => {
      const input = z
        .object({
          name: z.string().trim().min(1).max(100),
          scopes: z.array(apiKeyScopeSchema).min(1),
        })
        .parse(request.body);
      return reply.code(201).send({
        data: await deps.auth!.createKey(input.name, [
          ...new Set(input.scopes),
        ]),
      });
    },
  );
  app.delete(
    "/v1/admin/keys/:id",
    { preHandler: requireScope("admin") },
    async (request, reply) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      return (await deps.auth!.revoke(id))
        ? reply.code(204).send()
        : reply.code(404).send({
            error: {
              code: "API_KEY_NOT_FOUND",
              message: "API key not found.",
            },
          });
    },
  );
  app.get(
    "/v1/admin/providers",
    { preHandler: requireScope("admin") },
    async () => ({
      data: {
        brave: { configured: deps.brave?.configured ?? false },
        openai: {
          configured: deps.openai?.configured ?? false,
          model: config.OPENAI_MODEL ?? null,
        },
      },
    }),
  );
  app.post(
    "/v1/fetch",
    { preHandler: requireScope("fetch") },
    async (request, reply) => {
      const input = fetchRequestSchema.parse(request.body);
      if (!deps.operations || !deps.robots)
        throw new AppError(
          "Fetch persistence is unavailable.",
          503,
          "SERVICE_UNAVAILABLE",
        );
      const created = await deps.operations.create("fetch", input, {
        idempotencyKey: request.headers["idempotency-key"] as
          string | undefined,
      });
      const operation = created.operation;
      if (!created.isNew)
        return reply.code(200).send(
          replayEnvelope(operation, (result) => ({
            operationId: operation.id,
            data: result,
          })),
        );
      await deps.operations.markRunning(operation.id);
      try {
        const robotsAllowed = await deps.robots.assertAllowed(
          input.url,
          input.robotsPolicy,
        );
        const response = await fetchDocument(input, config.FETCH_MAX_BYTES);
        response.operationId = operation.id;
        response.data.source.robotsAllowed = robotsAllowed;
        await deps.operations.complete(operation.id, response.data);
        return reply.code(200).send(response);
      } catch (error) {
        await deps.operations.fail(
          operation.id,
          "FETCH_FAILED",
          error instanceof Error ? error.message : "Fetch failed",
        );
        throw error;
      }
    },
  );
  if (deps.collections)
    registerCollectionRoutes(app, deps.collections, requireScope);
  if (deps.surveys) registerSurveyRoutes(app, deps.surveys, requireScope);
  if (deps.shapes) registerShapeRoutes(app, deps.shapes, requireScope);
  if (deps.operations && deps.brave)
    registerSearchRoutes(app, deps.operations, deps.brave, requireScope);
  app.get(
    "/v1/operations",
    { preHandler: requireScope("admin") },
    async (request) => {
      const q = z
        .object({
          cursor: z.string().datetime().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          type: operationTypeSchema.optional(),
          status: operationStatusSchema.optional(),
        })
        .parse(request.query);
      return deps.operations!.list(q.cursor, q.limit, q.type, q.status);
    },
  );
  app.get(
    "/v1/operations/:id",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request) => {
      const principal = await authenticate(request);
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const item = await deps.operations!.get(id);
      if (!item)
        throw new AppError("Operation not found.", 404, "OPERATION_NOT_FOUND");
      await authorizeOperation(principal, item.type);
      return { data: item };
    },
  );
  app.post(
    "/v1/operations/:id/cancel",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request) => {
      const principal = await authenticate(request);
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const existing = await deps.operations!.get(id);
      if (!existing)
        throw new AppError("Operation not found.", 404, "OPERATION_NOT_FOUND");
      await authorizeOperation(principal, existing.type);
      const item = await deps.operations!.cancel(id);
      if (!item)
        throw new AppError("Operation not found.", 404, "OPERATION_NOT_FOUND");
      return { data: item };
    },
  );
  app.delete(
    "/v1/operations/:id",
    { preHandler: requireScope("admin") },
    async (request, reply) =>
      (await deps.operations!.delete(
        z.object({ id: z.uuid() }).parse(request.params).id,
      ))
        ? reply.code(204).send()
        : reply.code(404).send(),
  );
  app.get(
    "/v1/operations/:id/export",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const principal = await authenticate(request);
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const { format } = z
        .object({
          format: z.enum(["json", "jsonl", "markdown"]).default("json"),
        })
        .parse(request.query);
      const item = await deps.operations!.get(id);
      if (!item)
        throw new AppError("Operation not found.", 404, "OPERATION_NOT_FOUND");
      await authorizeOperation(principal, item.type);
      if (format === "jsonl") {
        const candidate = item.result as Record<string, unknown> | null;
        const rows = Array.isArray(item.result)
          ? item.result
          : candidate && Array.isArray(candidate.results)
            ? candidate.results
            : [item];
        reply.type("application/x-ndjson");
        reply.header(
          "content-disposition",
          `attachment; filename=stratafetch-${id}.jsonl`,
        );
        return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
      }
      if (format === "markdown") {
        reply.type("text/markdown; charset=utf-8");
        reply.header(
          "content-disposition",
          `attachment; filename=stratafetch-${id}.md`,
        );
        return `# Stratafetch ${item.type} operation\n\n- ID: \`${item.id}\`\n- Status: **${item.status}**\n- Created: ${item.createdAt}\n\n## Result\n\n\`\`\`json\n${JSON.stringify(item.result, null, 2)}\n\`\`\`\n`;
      }
      reply.header(
        "content-disposition",
        `attachment; filename=stratafetch-${id}.json`,
      );
      return item;
    },
  );
  app.get(
    "/metrics",
    { preHandler: requireScope("admin") },
    async (_request, reply) => {
      const out = await deps.pool!.query<{ status: string; count: string }>(
        "SELECT status,count(*) FROM operations GROUP BY status",
      );
      reply.type("text/plain; version=0.0.4");
      return (
        [
          `# HELP stratafetch_operations_total Operations by status`,
          `# TYPE stratafetch_operations_total gauge`,
          ...out.rows.map(
            (r) =>
              `stratafetch_operations_total{status=\"${r.status}\"} ${r.count}`,
          ),
        ].join("\n") + "\n"
      );
    },
  );
  if (config.DASHBOARD_DIR && existsSync(resolve(config.DASHBOARD_DIR))) {
    app.register(fastifyStatic, {
      root: resolve(config.DASHBOARD_DIR),
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) =>
      request.method === "GET" && !request.url.startsWith("/v1/")
        ? reply.sendFile("index.html")
        : reply.code(404).send({
            error: { code: "NOT_FOUND", message: "Route not found." },
          }),
    );
  }
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "The request is invalid.",
          details: error.issues,
        },
      });
    if (error instanceof AppError)
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    app.log.error(error);
    Sentry.captureException(error);
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    });
  });
  return app;
}
