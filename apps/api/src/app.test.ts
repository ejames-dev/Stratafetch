import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
const config = loadConfig({
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DASHBOARD_DIR: "/does-not-exist",
  STRATAFETCH_ADMIN_TOKEN: "test-admin-token-at-least-24-characters",
});
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));
const auth = {
  validateSession: () => false,
  authorize: async () => true,
  isAdminToken: () => true,
  createSession: () => ({ value: "session", expires: Date.now() + 1000 }),
  listKeys: async () => [],
  createKey: async () => ({}),
  revoke: async () => true,
} as never;
describe("API", () => {
  it("reports versioned health", async () => {
    const app = buildApp(config);
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "stratafetch-api",
      version: "1.0.0-alpha.2",
    });
  });
  it("requires authentication", async () => {
    const app = buildApp(config, { auth });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/fetch",
      payload: { url: "not-a-url" },
    });
    expect(response.statusCode).toBe(401);
  });
  it("validates authenticated requests", async () => {
    const app = buildApp(config, { auth });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/fetch",
      headers: { authorization: "Bearer valid" },
      payload: { url: "not-a-url" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });
});
