import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "./config.js";
import { buildApp } from "./app.js";
import type { CollectionService } from "./collections/service.js";

const config: AppConfig = {
  HOST: "127.0.0.1",
  PORT: 43_100,
  LOG_LEVEL: "silent",
  FETCH_MAX_BYTES: 1024 * 1024,
  DATABASE_URL: "postgresql://stratafetch:stratafetch@localhost:5432/stratafetch",
  REDIS_URL: "redis://localhost:6379",
  COLLECTION_DELAY_MS: 0
};

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("API", () => {
  it("reports health", async () => {
    const app = buildApp(config);
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "stratafetch-api" });
  });

  it("validates fetch requests", async () => {
    const app = buildApp(config);
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/v1/fetch", payload: { url: "not-a-url" } });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("accepts a collection through the configured service", async () => {
    const id = "82d0c44b-3ae9-4ee9-bf02-b783379e7294";
    const collections: CollectionService = {
      create: async (request) => ({
        ...request,
        id,
        status: "queued",
        discoveredPages: 1,
        processedPages: 0,
        failedPages: 0,
        error: null,
        createdAt: new Date(0).toISOString(),
        startedAt: null,
        completedAt: null
      }),
      get: async () => { throw new Error("not used"); },
      listPages: async () => []
    };
    const app = buildApp(config, { collections });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/collections",
      payload: { startUrl: "https://example.com", maxPages: 5 }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      data: { id, status: "queued", maxPages: 5, mode: "http" }
    });
  });
});
