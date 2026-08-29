import type { FastifyInstance } from "fastify";
import { searchRequestSchema } from "@stratafetch/contracts";
import type { OperationRepository } from "../operations/repository.js";
import type { BraveSearchProvider } from "../providers/brave.js";
export function registerSearchRoutes(
  app: FastifyInstance,
  operations: OperationRepository,
  provider: BraveSearchProvider,
  guard: (scope: "search") => unknown,
) {
  app.post(
    "/v1/search",
    { preHandler: guard("search") as never },
    async (request) => {
      const input = searchRequestSchema.parse(request.body);
      const created = await operations.create("search", input, {
        idempotencyKey: request.headers["idempotency-key"] as
          string | undefined,
        provider: "brave",
      });
      const operation = created.operation;
      if (!created.isNew) return { data: operation };
      await operations.markRunning(operation.id);
      try {
        const results = await provider.search(input);
        await operations.complete(operation.id, { results });
        return { data: { operationId: operation.id, results } };
      } catch (error) {
        await operations.fail(
          operation.id,
          "SEARCH_FAILED",
          error instanceof Error ? error.message : "Search failed",
        );
        throw error;
      }
    },
  );
}
