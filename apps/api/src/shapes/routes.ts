import type { FastifyInstance } from "fastify";
import { shapeRequestSchema } from "@stratafetch/contracts";
import { ShapeService } from "./service.js";
export function registerShapeRoutes(
  app: FastifyInstance,
  service: ShapeService,
  guard: (scope: "shape") => unknown,
) {
  app.post(
    "/v1/shapes",
    { preHandler: guard("shape") as never },
    async (request, reply) =>
      reply.code(202).send({
        data: await service.create(
          shapeRequestSchema.parse(request.body),
          request.headers["idempotency-key"] as string | undefined,
        ),
      }),
  );
}
