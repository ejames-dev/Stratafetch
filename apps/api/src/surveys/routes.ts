import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { surveyRequestSchema } from "@stratafetch/contracts";
import { SurveyService } from "./service.js";
const params = z.object({ id: z.uuid() });
const query = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().datetime().optional(),
});
export function registerSurveyRoutes(
  app: FastifyInstance,
  service: SurveyService,
  guard: (scope: "survey") => unknown,
) {
  app.post(
    "/v1/surveys",
    { preHandler: guard("survey") as never },
    async (request, reply) =>
      reply.code(202).send({
        data: await service.create(
          surveyRequestSchema.parse(request.body),
          request.headers["idempotency-key"] as string | undefined,
        ),
      }),
  );
  app.get(
    "/v1/surveys/:id",
    { preHandler: guard("survey") as never },
    async (request) => ({
      data: await service.get(params.parse(request.params).id),
    }),
  );
  app.get(
    "/v1/surveys/:id/urls",
    { preHandler: guard("survey") as never },
    async (request) => {
      const { id } = params.parse(request.params);
      const { limit, cursor } = query.parse(request.query);
      return service.urls(id, limit, cursor);
    },
  );
}
