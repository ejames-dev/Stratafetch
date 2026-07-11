import { Worker } from "bullmq";
import { collectionQueueName, createRedisConnection, type CollectionJobData } from "./collections/queue.js";
import { processCollection } from "./collections/processor.js";
import { PostgresCollectionRepository } from "./collections/repository.js";
import { loadConfig } from "./config.js";
import { runMigrations } from "./database/migrate.js";
import { createDatabasePool } from "./database/pool.js";
import { fetchDocument } from "./fetch/service.js";

const config = loadConfig();
const pool = createDatabasePool(config.DATABASE_URL);
await runMigrations(pool);
const repository = new PostgresCollectionRepository(pool);
const redis = createRedisConnection(config.REDIS_URL);

const worker = new Worker<CollectionJobData, void, "collect">(collectionQueueName, async (job) => {
  await processCollection({
    collectionId: job.data.collectionId,
    repository,
    fetcher: fetchDocument,
    maxBytes: config.FETCH_MAX_BYTES,
    delayMs: config.COLLECTION_DELAY_MS
  });
}, { connection: redis, concurrency: 2 });

worker.on("completed", (job) => console.info(`Collection ${job.data.collectionId} completed.`));
worker.on("failed", (job, error) => console.error(`Collection ${job?.data.collectionId ?? "unknown"} failed.`, error));

async function shutdown() {
  await worker.close();
  await pool.end();
}

process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
