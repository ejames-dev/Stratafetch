import { buildApp } from "./app.js";
import { createCollectionQueue, createRedisConnection } from "./collections/queue.js";
import { PostgresCollectionRepository } from "./collections/repository.js";
import { DefaultCollectionService } from "./collections/service.js";
import { loadConfig } from "./config.js";
import { runMigrations } from "./database/migrate.js";
import { createDatabasePool } from "./database/pool.js";

const config = loadConfig();
const pool = createDatabasePool(config.DATABASE_URL);
await runMigrations(pool);
const redis = createRedisConnection(config.REDIS_URL);
const queue = createCollectionQueue(redis);
const collections = new DefaultCollectionService(
  new PostgresCollectionRepository(pool),
  queue
);
const app = buildApp(config, { collections });

app.addHook("onClose", async () => {
  await queue.close();
  await pool.end();
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
