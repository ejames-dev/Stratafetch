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

// A key whose granted scopes are exactly `granted`; the admin token is not honored.
const scopedAuth = (granted: string[]) =>
  ({
    validateSession: () => false,
    authorize: async (_token: string, scope: string) => granted.includes(scope),
    isAdminToken: () => false,
    createSession: () => ({ value: "session", expires: Date.now() + 1000 }),
    listKeys: async () => [],
    createKey: async () => ({}),
    revoke: async () => true,
  }) as never;

const operationId = "11111111-1111-4111-8111-111111111111";
const operationsWith = (type: string) =>
  ({
    get: async () => ({ id: operationId, type, status: "completed" }),
    cancel: async () => ({ id: operationId, type, status: "cancelled" }),
  }) as never;

describe("operation scope authorization", () => {
  it("lets a capability key read an operation of its own type", async () => {
    const app = buildApp(config, {
      auth: scopedAuth(["shape"]),
      operations: operationsWith("shape"),
    });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: `/v1/operations/${operationId}`,
      headers: { authorization: "Bearer shape-key" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.type).toBe("shape");
  });

  it("rejects a key whose scope does not match the operation type", async () => {
    const app = buildApp(config, {
      auth: scopedAuth(["fetch"]),
      operations: operationsWith("shape"),
    });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: `/v1/operations/${operationId}`,
      headers: { authorization: "Bearer fetch-key" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("maps a collection operation to the collect scope", async () => {
    const app = buildApp(config, {
      auth: scopedAuth(["collect"]),
      operations: operationsWith("collection"),
    });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: `/v1/operations/${operationId}`,
      headers: { authorization: "Bearer collect-key" },
    });
    expect(response.statusCode).toBe(200);
  });

  it("requires authentication before reading an operation", async () => {
    const app = buildApp(config, {
      auth: scopedAuth(["shape"]),
      operations: operationsWith("shape"),
    });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: `/v1/operations/${operationId}`,
    });
    expect(response.statusCode).toBe(401);
  });

  it("keeps the operation list admin-only", async () => {
    const app = buildApp(config, {
      auth: scopedAuth(["shape"]),
      operations: operationsWith("shape"),
    });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/operations",
      headers: { authorization: "Bearer shape-key" },
    });
    expect(response.statusCode).toBe(403);
  });
});
