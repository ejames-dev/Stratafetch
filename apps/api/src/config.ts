import { z } from "zod";

const configSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(43_100),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  FETCH_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .default(10 * 1024 * 1024),
  DATABASE_URL: z
    .url()
    .default("postgresql://stratafetch:stratafetch@localhost:5432/stratafetch"),
  REDIS_URL: z.url().default("redis://localhost:6379"),
  COLLECTION_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(250),
  STRATAFETCH_ADMIN_TOKEN: z
    .string()
    .min(24)
    .default("development-admin-token-change-me"),
  ALLOW_ROBOTS_OVERRIDE: z.stringbool().default(false),
  CONTENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  HTTP_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
  BROWSER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  PER_HOST_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(1_000),
  DASHBOARD_DIR: z.string().default("apps/web/dist"),
  EGRESS_PROXY_URL: z.url().optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  return configSchema.parse(environment);
}
