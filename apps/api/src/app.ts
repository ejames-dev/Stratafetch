import Fastify from "fastify";
import { ZodError } from "zod";
import { fetchRequestSchema } from "@stratafetch/contracts";
import type { AppConfig } from "./config.js";
import { AppError } from "./errors.js";
import { fetchDocument } from "./fetch/service.js";
import { registerCollectionRoutes } from "./collections/routes.js";
import type { CollectionService } from "./collections/service.js";

export function buildApp(config: AppConfig, dependencies: { collections?: CollectionService } = {}) {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  app.get("/health", async () => ({ status: "ok", service: "stratafetch-api" }));

  app.post("/v1/fetch", async (request, reply) => {
    const input = fetchRequestSchema.parse(request.body);
    const response = await fetchDocument(input, config.FETCH_MAX_BYTES);
    return reply.code(200).send(response);
  });

  if (dependencies.collections) registerCollectionRoutes(app, dependencies.collections);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: { code: "INVALID_REQUEST", message: "The request body is invalid.", details: error.issues }
      });
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    app.log.error(error);
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
  });

  return app;
}
