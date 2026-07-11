import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { collectionRequestSchema } from "@stratafetch/contracts";
import type { CollectionService } from "./service.js";

const collectionParamsSchema = z.object({ id: z.uuid() });

export function registerCollectionRoutes(app: FastifyInstance, service: CollectionService) {
  app.post("/v1/collections", async (request, reply) => {
    const input = collectionRequestSchema.parse(request.body);
    const collection = await service.create(input);
    return reply.code(202).send({ data: collection });
  });

  app.get("/v1/collections/:id", async (request) => {
    const { id } = collectionParamsSchema.parse(request.params);
    return { data: await service.get(id) };
  });

  app.get("/v1/collections/:id/pages", async (request) => {
    const { id } = collectionParamsSchema.parse(request.params);
    return { data: await service.listPages(id) };
  });
}
