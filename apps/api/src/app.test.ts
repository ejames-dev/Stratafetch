import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
const config = loadConfig({
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DASHBOARD_DIR: "/does-not-exist",
  STRATAFETCH_ADMIN_TOKEN: "test-admin-token-at-least-24-characters",
});
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));
const auth = {
  validateSession: () => false,
  authorize: async () => true,
  isAdminToken: () => true,
  createSession: () => ({ value: "session", expires: Date.now() + 1000 }),
  listKeys: async () => [],
  createKey: async () => ({}),
  revoke: async () => true,
} as never;
describe("API", () => {
  it("reports versioned health", async () => {
    const app = buildApp(config);
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "stratafetch-api",
      version: "1.0.0-alpha.1",
    });
  });
  it("requires authentication", async () => {
    const app = buildApp(config, { auth });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/fetch",
      payload: { url: "not-a-url" },
    });
    expect(response.statusCode).toBe(401);
  });
  it("validates authenticated requests", async () => {
    const app = buildApp(config, { auth });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/fetch",
      headers: { authorization: "Bearer valid" },
      payload: { url: "not-a-url" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });
});

// A key whose granted scopes are exactly `granted`; the admin token is not honored.
const scopedAuth = (granted: string[]) =>
  ({
    validateSession: () => false,
    authorize: async (_token: string, scope: string) => granted.includes(scope),
    isAdminToken: () => false,
    createSession: () => ({ value: "session", expires: Date.now() + 1000 }),
    listKeys: async () => [],
    createKey: async () => ({}),
    revoke: async () => true,
  }) as never;

const operationId = "11111111-1111-4111-8111-111111111111";
const operationsWith = (type: string) =>
  ({
    get: async () => ({ id: operationId, type, status: "completed" }),
    cancel: async () => ({ id: operationId, type, status: "cancelled" }),
  }) as never;

describe("operation scope authorization", () => {
  it("lets a capability key read an operation of its own type", async () => {
    const app = buildApp(config, {
      auth: scopedAuth(["shape"]),
      operations: operationsWith("shape"),
    });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: `/v1/operations/${operationId}`,
      headers: { authorization: "Bearer shape-key" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.type).toBe("shape");
  });

  it("rejects a key whose scope does not match the operation type", async () => {
    const app = buildApp(config, {
      auth: scopedAuth(["fetch"]),
      operations: operationsWith("shape"),
    });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: `/v1/operations/${operationId}`,
      headers: { authorization: "Bearer fetch-key" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("maps a collection operation to the collect scope", async () => {
    const app = buildApp(config, {
      auth: scopedAuth(["collect"]),
      operations: operationsWith("collection"),
    });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: `/v1/operations/${operationId}`,
      headers: { authorization: "Bearer collect-key" },
    });
    expect(response.statusCode).toBe(200);
  });

  it("requires authentication before reading an operation", async () => {
    const app = buildApp(config, {
      auth: scopedAuth(["shape"]),
      operations: operationsWith("shape"),
    });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: `/v1/operations/${operationId}`,
    });
    expect(response.statusCode).toBe(401);
  });

  it("keeps the operation list admin-only", async () => {
    const app = buildApp(config, {
      auth: scopedAuth(["shape"]),
      operations: operationsWith("shape"),
    });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/operations",
      headers: { authorization: "Bearer shape-key" },
    });
    expect(response.statusCode).toBe(403);
  });
});

// A repository whose `create` always replays `operation` instead of inserting.
const replaying = (operation: Record<string, unknown>) =>
  ({ create: async () => ({ operation, isNew: false }) }) as never;
const robots = { assertAllowed: async () => true } as never;
const brave = { configured: true, search: async () => [] } as never;

describe("idempotent replay envelope", () => {
  it("replays a fetch in the same shape as the original response", async () => {
    const result = {
      source: {
        requestedUrl: "https://example.org",
        resolvedUrl: "https://example.org/",
        status: 200,
        contentType: "text/html",
        robotsAllowed: true,
      },
      content: { markdown: "# Example" },
      retrieval: {
        mode: "http",
        fetchedAt: "2026-01-01T00:00:00.000Z",
        durationMs: 5,
      },
    };
    const app = buildApp(config, {
      auth: scopedAuth(["fetch"]),
      robots,
      operations: replaying({
        id: operationId,
        type: "fetch",
        status: "completed",
        result,
      }),
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/fetch",
      headers: { authorization: "Bearer fetch-key", "idempotency-key": "k1" },
      payload: { url: "https://example.org" },
    });
    expect(response.statusCode).toBe(200);
    // Same envelope as a fresh fetch: top-level operationId, data holding the outputs.
    expect(response.json()).toEqual({ operationId, data: result });
  });

  it("replays a search in the same shape as the original response", async () => {
    const results = [
      {
        rank: 1,
        title: "Example",
        url: "https://example.org",
        description: "",
        provider: "brave",
      },
    ];
    const app = buildApp(config, {
      auth: scopedAuth(["search"]),
      brave,
      operations: replaying({
        id: operationId,
        type: "search",
        status: "completed",
        result: { results },
      }),
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      headers: { authorization: "Bearer search-key", "idempotency-key": "k2" },
      payload: { query: "example" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { operationId, results } });
  });

  it("re-raises the stored error when replaying a failed operation", async () => {
    const app = buildApp(config, {
      auth: scopedAuth(["fetch"]),
      robots,
      operations: replaying({
        id: operationId,
        type: "fetch",
        status: "failed",
        result: null,
        error: { code: "FETCH_FAILED", message: "Upstream refused." },
      }),
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/fetch",
      headers: { authorization: "Bearer fetch-key", "idempotency-key": "k3" },
      payload: { url: "https://example.org" },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("FETCH_FAILED");
  });
});
