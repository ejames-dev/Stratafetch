import type { ShapeRequest } from "@stratafetch/contracts";
import type { DatabasePool } from "../database/pool.js";
import type { OperationRepository } from "../operations/repository.js";
import type { OpenAIShapeProvider } from "../providers/openai.js";
export async function processShape(options: {
  operationId: string;
  request: ShapeRequest;
  pool: DatabasePool;
  operations: OperationRepository;
  provider: OpenAIShapeProvider;
}) {
  await options.operations.markRunning(options.operationId);
  try {
    let content: string;
    if (options.request.source.type === "inline")
      content = options.request.source.content;
    else if (options.request.source.type === "fetch") {
      const op = await options.operations.get(options.request.source.fetchId);
      content = JSON.stringify(op?.result ?? "");
    } else {
      const values: unknown[] = [options.request.source.collectionId];
      let filter = "";
      if (options.request.source.pageIds?.length) {
        values.push(options.request.source.pageIds);
        filter = "AND id=ANY($2::uuid[])";
      }
      const out = await options.pool.query<{ content: unknown }>(
        `SELECT content FROM collection_pages WHERE collection_id=$1 ${filter} AND content IS NOT NULL ORDER BY created_at`,
        values,
      );
      content = out.rows.map((r) => JSON.stringify(r.content)).join("\n");
    }
    if (Buffer.byteLength(content) > 2_000_000)
      throw new Error("Shape input exceeds the 2 MB limit.");
    const result = await options.provider.shape(
      content,
      options.request.schema,
      options.request.instructions,
    );
    await options.operations.complete(
      options.operationId,
      { data: result.value },
      result.usage,
    );
  } catch (error) {
    await options.operations.fail(
      options.operationId,
      "SHAPE_FAILED",
      error instanceof Error ? error.message : "Shape failed",
    );
    throw error;
  }
}
