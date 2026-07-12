import type { ShapeRequest } from "@stratafetch/contracts";
import { AppError } from "../errors.js";
import type { OperationRepository } from "../operations/repository.js";
import type { OperationJobQueue } from "../operations/queue.js";
import type { DatabasePool } from "../database/pool.js";
export class ShapeService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly operations: OperationRepository,
    private readonly queue: OperationJobQueue,
    private readonly configured: boolean,
  ) {}
  async create(request: ShapeRequest, idempotencyKey?: string) {
    if (!this.configured)
      throw new AppError(
        "OpenAI Shape is not configured.",
        503,
        "PROVIDER_NOT_CONFIGURED",
      );
    if (request.source.type === "fetch") {
      const row = await this.operations.get(request.source.fetchId);
      if (!row || row.type !== "fetch")
        throw new AppError("Fetch result not found.", 404, "FETCH_NOT_FOUND");
    }
    if (request.source.type === "collection") {
      const out = await this.pool.query(
        "SELECT 1 FROM collections WHERE id=$1",
        [request.source.collectionId],
      );
      if (!out.rowCount)
        throw new AppError(
          "Collection not found.",
          404,
          "COLLECTION_NOT_FOUND",
        );
    }
    const created = await this.operations.create("shape", request, {
      idempotencyKey,
      provider: "openai",
    });
    if (created.isNew)
      await this.queue.enqueue({
        operationId: created.operation.id,
        type: "shape",
        resourceId: created.operation.id,
      });
    return created.operation;
  }
}
