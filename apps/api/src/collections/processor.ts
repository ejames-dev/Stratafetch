import type {
  CollectionRequest,
  FetchRequest,
  FetchResponse,
} from "@stratafetch/contracts";
import type { OperationRepository } from "../operations/repository.js";
import type { RobotsService } from "../robots/service.js";
import type { SurveyRepository } from "../surveys/repository.js";
import { PostgresCollectionRepository } from "./repository.js";
export type CollectionFetcher = (
  request: FetchRequest,
  maxBytes: number,
) => Promise<FetchResponse>;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const select = (
  content: FetchResponse["data"]["content"],
  outputs: CollectionRequest["outputs"],
) =>
  Object.fromEntries(
    Object.entries(content).filter(([key]) => outputs.includes(key as never)),
  );
export async function processCollection(options: {
  collectionId: string;
  repo: PostgresCollectionRepository;
  surveys: SurveyRepository;
  operations: OperationRepository;
  robots: RobotsService;
  fetcher: CollectionFetcher;
  maxBytes: number;
  delayMs: number;
}) {
  const item = await options.repo.get(options.collectionId);
  if (!item) throw new Error("Collection not found");
  const urls =
    item.source.type === "survey"
      ? await options.surveys.allUrls(item.source.surveyId)
      : item.source.urls;
  await options.operations.markRunning(item.operationId);
  await options.repo.updateStatus(item.id, "running");
  let processed = 0,
    failed = 0;
  try {
    for (const url of urls) {
      if (await options.operations.isCancellationRequested(item.operationId)) {
        await options.repo.updateStatus(item.id, "cancelled");
        await options.operations.markCancelled(item.operationId);
        return;
      }
      try {
        const robotsAllowed = await options.robots.assertAllowed(
          url,
          item.robotsPolicy,
        );
        const response = await options.fetcher(
          {
            url,
            mode: item.mode,
            outputs: item.outputs,
            timeoutMs: item.timeoutMs,
            waitAfterLoadMs: item.waitAfterLoadMs,
            robotsPolicy: item.robotsPolicy,
          },
          options.maxBytes,
        );
        response.data.source.robotsAllowed = robotsAllowed;
        await options.repo.savePage({
          collectionId: item.id,
          url,
          status: "completed",
          source: response.data.source,
          content: select(response.data.content, item.outputs),
          error: null,
          expiresAt:
            (await options.operations.get(item.operationId))
              ?.contentExpiresAt ?? null,
        });
      } catch (error) {
        failed++;
        await options.repo.savePage({
          collectionId: item.id,
          url,
          status: "failed",
          source: null,
          content: null,
          error: error instanceof Error ? error.message : "Unknown error",
          expiresAt: null,
        });
      }
      processed++;
      await options.repo.setProgress(item.id, processed, failed);
      if (processed < urls.length && options.delayMs)
        await sleep(options.delayMs);
    }
    if (processed && failed === processed)
      throw new Error("Every page in the collection failed.");
    await options.repo.updateStatus(item.id, "completed");
    await options.operations.complete(item.operationId, {
      collectionId: item.id,
      processedPages: processed,
      failedPages: failed,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Collection failed";
    await options.repo.updateStatus(item.id, "failed", message);
    await options.operations.fail(
      item.operationId,
      "COLLECTION_FAILED",
      message,
    );
    throw error;
  }
}
