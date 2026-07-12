import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { collectionRequestSchema } from "@stratafetch/contracts";
import { CollectionService } from "./service.js";
const params = z.object({ id: z.uuid() });
const query = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().datetime().optional(),
});
export function registerCollectionRoutes(
  app: FastifyInstance,
  service: CollectionService,
  guard: (scope: "collect") => unknown,
) {
  app.post(
    "/v1/collections",
    { preHandler: guard("collect") as never },
    async (request, reply) =>
      reply.code(202).send({
        data: await service.create(
          collectionRequestSchema.parse(request.body),
          request.headers["idempotency-key"] as string | undefined,
        ),
      }),
  );
  app.get(
    "/v1/collections/:id",
    { preHandler: guard("collect") as never },
    async (request) => ({
      data: await service.get(params.parse(request.params).id),
    }),
  );
  app.get(
    "/v1/collections/:id/pages",
    { preHandler: guard("collect") as never },
    async (request) => {
      const { id } = params.parse(request.params);
      const { limit, cursor } = query.parse(request.query);
      return service.pages(id, limit, cursor);
    },
  );
}
