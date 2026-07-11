import { z } from "zod";

const configSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(43_100),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  FETCH_MAX_BYTES: z.coerce.number().int().min(1_024).default(10 * 1024 * 1024),
  DATABASE_URL: z.url().default("postgresql://stratafetch:stratafetch@localhost:5432/stratafetch"),
  REDIS_URL: z.url().default("redis://localhost:6379"),
  COLLECTION_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(250)
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(environment);
}
