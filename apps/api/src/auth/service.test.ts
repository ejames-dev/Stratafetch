import { describe, expect, it, vi } from "vitest";
import { AuthService } from "./service.js";

const ADMIN_TOKEN = "admin-token-for-tests-only";

function setup() {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  const pool = { query };
  const auth = new AuthService(pool as never, ADMIN_TOKEN);
  return { auth, query };
}

describe("AuthService", () => {
  describe("isAdminToken", () => {
    it("accepts the configured admin token", () => {
      const { auth } = setup();
      expect(auth.isAdminToken(ADMIN_TOKEN)).toBe(true);
    });

    it("rejects a different token", () => {
      const { auth } = setup();
      expect(auth.isAdminToken("wrong-token")).toBe(false);
    });

    it("rejects a token of a different length without throwing", () => {
      const { auth } = setup();
      expect(auth.isAdminToken("x")).toBe(false);
    });
  });

  describe("session", () => {
    it("validates a session it just created", () => {
      const { auth } = setup();
      const session = auth.createSession();
      expect(auth.validateSession(session.value)).toBe(true);
    });

    it("rejects a missing session value", () => {
      const { auth } = setup();
      expect(auth.validateSession(undefined)).toBe(false);
    });

    it("rejects a malformed session value", () => {
      const { auth } = setup();
      expect(auth.validateSession("not-a-valid-session")).toBe(false);
    });

    it("rejects an expired session", () => {
      const { auth } = setup();
      const expiredPayload = String(Date.now() - 1_000);
      const session = auth.createSession();
      const [, signature] = session.value.split(".");
      expect(auth.validateSession(`${expiredPayload}.${signature}`)).toBe(
        false,
      );
    });

    it("rejects a tampered signature", () => {
      const { auth } = setup();
      const session = auth.createSession();
      const [payload] = session.value.split(".");
      expect(auth.validateSession(`${payload}.deadbeef`)).toBe(false);
    });

    it("rejects a session signed with a different admin token", () => {
      const { auth } = setup();
      const other = new AuthService({} as never, "a-different-admin-token");
      const session = other.createSession();
      expect(auth.validateSession(session.value)).toBe(false);
    });
  });

  describe("createKey", () => {
    it("stores a hashed key and returns the secret once", async () => {
      const { auth, query } = setup();
      const result = await auth.createKey("ci key", ["fetch", "survey"]);

      expect(result.secret.startsWith("sf_")).toBe(true);
      expect(result.prefix).toBe(result.secret.slice(0, 11));
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO api_keys"),
        [
          result.id,
          "ci key",
          result.prefix,
          expect.any(String),
          JSON.stringify(["fetch", "survey"]),
        ],
      );
      const [, params] = query.mock.calls[0]!;
      const storedHash = (params as unknown[])[3];
      expect(storedHash).not.toBe(result.secret);
    });
  });

  describe("authorize", () => {
    it("authorizes the admin token without querying the database", async () => {
      const { auth, query } = setup();
      await expect(auth.authorize(ADMIN_TOKEN, "fetch")).resolves.toBe(true);
      expect(query).not.toHaveBeenCalled();
    });

    it("authorizes a key that holds the required scope and touches last_used_at", async () => {
      const { auth, query } = setup();
      query.mockImplementation(async (sql: string) => {
        if (sql.includes("SELECT id,scopes"))
          return { rows: [{ id: "key-1", scopes: ["fetch"] }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      });

      await expect(auth.authorize("some-key", "fetch")).resolves.toBe(true);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE api_keys SET last_used_at"),
        ["key-1"],
      );
    });

    it("authorizes a key that holds the admin scope for any required scope", async () => {
      const { auth, query } = setup();
      query.mockImplementation(async (sql: string) => {
        if (sql.includes("SELECT id,scopes"))
          return { rows: [{ id: "key-1", scopes: ["admin"] }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      });

      await expect(auth.authorize("some-key", "shape")).resolves.toBe(true);
    });

    it("rejects a key that lacks the required scope", async () => {
      const { auth, query } = setup();
      query.mockImplementation(async (sql: string) => {
        if (sql.includes("SELECT id,scopes"))
          return { rows: [{ id: "key-1", scopes: ["fetch"] }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      });

      await expect(auth.authorize("some-key", "shape")).resolves.toBe(false);
    });

    it("rejects an unknown or revoked key", async () => {
      const { auth } = setup();
      await expect(auth.authorize("unknown-key", "fetch")).resolves.toBe(false);
    });
  });

  describe("revoke", () => {
    it("returns true when a key was revoked", async () => {
      const { auth, query } = setup();
      query.mockResolvedValue({ rows: [], rowCount: 1 });
      await expect(auth.revoke("key-1")).resolves.toBe(true);
    });

    it("returns false when no key matched", async () => {
      const { auth, query } = setup();
      query.mockResolvedValue({ rows: [], rowCount: 0 });
      await expect(auth.revoke("key-1")).resolves.toBe(false);
    });
  });
});
