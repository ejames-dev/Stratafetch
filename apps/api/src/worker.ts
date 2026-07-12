import { Worker } from "bullmq";
import type {
  CollectionRequest,
  ShapeRequest,
  SurveyRequest,
} from "@stratafetch/contracts";
import { processCollection } from "./collections/processor.js";
import { PostgresCollectionRepository } from "./collections/repository.js";
import { loadConfig } from "./config.js";
import { runMigrations } from "./database/migrate.js";
import { createDatabasePool } from "./database/pool.js";
import { fetchDocument } from "./fetch/service.js";
import {
  operationQueueName,
  createRedisConnection,
  type OperationJobData,
} from "./operations/queue.js";
import { OperationRepository } from "./operations/repository.js";
import { OpenAIShapeProvider } from "./providers/openai.js";
import { RobotsService } from "./robots/service.js";
import { processShape } from "./shapes/processor.js";
import { SurveyRepository } from "./surveys/repository.js";
import { processSurvey } from "./surveys/processor.js";
const config = loadConfig();
const pool = createDatabasePool(config.DATABASE_URL);
await runMigrations(pool);
const operations = new OperationRepository(pool, config.CONTENT_RETENTION_DAYS);
const collections = new PostgresCollectionRepository(pool);
const surveys = new SurveyRepository(pool);
const robots = new RobotsService(config.ALLOW_ROBOTS_OVERRIDE);
const openai = new OpenAIShapeProvider(
  config.OPENAI_API_KEY,
  config.OPENAI_MODEL,
);
const connection = createRedisConnection(config.REDIS_URL);

function createLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit)
      await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

const withBrowserSlot = createLimiter(config.BROWSER_CONCURRENCY);
const worker = new Worker<OperationJobData, void, "run">(
  operationQueueName,
  async (job) => {
    const operation = await operations.get(job.data.operationId);
    if (!operation || operation.status === "cancelled") return;
    const run = async () => {
      if (job.data.type === "survey")
        await processSurvey({
          surveyId: job.data.resourceId,
          operationId: operation.id,
          request: operation.request as SurveyRequest,
          repo: surveys,
          operations,
          robots,
          fetcher: fetchDocument,
          maxBytes: config.FETCH_MAX_BYTES,
          delayMs: config.PER_HOST_DELAY_MS,
        });
      else if (job.data.type === "collection")
        await processCollection({
          collectionId: job.data.resourceId,
          repo: collections,
          surveys,
          operations,
          robots,
          fetcher: fetchDocument,
          maxBytes: config.FETCH_MAX_BYTES,
          delayMs: config.PER_HOST_DELAY_MS,
        });
      else
        await processShape({
          operationId: operation.id,
          request: operation.request as ShapeRequest,
          pool,
          operations,
          provider: openai,
        });
    };
    const request = operation.request as { mode?: string };
    if (request.mode === "browser") await withBrowserSlot(run);
    else await run();
  },
  { connection, concurrency: config.HTTP_CONCURRENCY },
);
worker.on("completed", (job) =>
  console.info(`Operation ${job.data.operationId} completed.`),
);
worker.on("failed", (job, error) =>
  console.error(
    `Operation ${job?.data.operationId ?? "unknown"} failed.`,
    error,
  ),
);
const retention = setInterval(
  () => void operations.expireContent(),
  24 * 60 * 60 * 1_000,
);
retention.unref();
async function shutdown() {
  clearInterval(retention);
  await worker.close();
  await pool.end();
}
process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
