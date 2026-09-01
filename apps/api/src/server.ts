import "./instrument.js";
import * as Sentry from "@sentry/node";
import { buildApp } from "./app.js";
import { AuthService } from "./auth/service.js";
import { PostgresCollectionRepository } from "./collections/repository.js";
import { CollectionService } from "./collections/service.js";
import { loadConfig } from "./config.js";
import { runMigrations } from "./database/migrate.js";
import { createDatabasePool } from "./database/pool.js";
import { OperationRepository } from "./operations/repository.js";
import {
  createOperationQueue,
  createRedisConnection,
} from "./operations/queue.js";
import { BraveSearchProvider } from "./providers/brave.js";
import { OpenAIShapeProvider } from "./providers/openai.js";
import { RobotsService } from "./robots/service.js";
import { ShapeService } from "./shapes/service.js";
import { SurveyRepository } from "./surveys/repository.js";
import { SurveyService } from "./surveys/service.js";
const config = loadConfig();
const pool = createDatabasePool(config.DATABASE_URL);
await runMigrations(pool);
const operations = new OperationRepository(pool, config.CONTENT_RETENTION_DAYS);
const auth = new AuthService(pool, config.STRATAFETCH_ADMIN_TOKEN);
const robots = new RobotsService(config.ALLOW_ROBOTS_OVERRIDE);
const brave = new BraveSearchProvider(config.BRAVE_SEARCH_API_KEY);
const openai = new OpenAIShapeProvider(
  config.OPENAI_API_KEY,
  config.OPENAI_MODEL,
);
const surveysRepo = new SurveyRepository(pool);
const collectionsRepo = new PostgresCollectionRepository(pool);
const queue = createOperationQueue(createRedisConnection(config.REDIS_URL));
const surveys = new SurveyService(surveysRepo, operations, queue);
const collections = new CollectionService(
  collectionsRepo,
  surveysRepo,
  operations,
  queue,
);
const shapes = new ShapeService(pool, operations, queue, openai.configured);
const app = buildApp(config, {
  pool,
  auth,
  operations,
  collections,
  surveys,
  shapes,
  robots,
  brave,
  openai,
  redisReady: () => queue.ready(),
});
app.addHook("onClose", async () => {
  await queue.close();
  await pool.end();
});
try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  Sentry.captureException(error);
  await app.close();
  process.exitCode = 1;
}
