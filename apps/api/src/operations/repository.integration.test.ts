import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { runMigrations } from "../database/migrate.js";
import { OperationRepository } from "./repository.js";

// Real Postgres only: the idempotency replay/conflict SQL and the CASE WHEN
// in cancel() are the kind of thing a hand-mocked pool.query can't actually
// validate. Skips locally without DATABASE_URL, fails loudly in CI if the
// `integration` job's env wiring ever breaks.
const shouldRun = Boolean(process.env.DATABASE_URL) || Boolean(process.env.CI);

describe.skipIf(!shouldRun)("OperationRepository (real Postgres)", () => {
  let adminPool: DatabasePool;
  let pool: DatabasePool;
  let dbName: string;
  let repo: OperationRepository;

  beforeAll(async () => {
    const baseUrl = new URL(
      process.env.DATABASE_URL ??
        "postgresql://stratafetch:stratafetch@localhost:5432/stratafetch",
    );
    adminPool = createDatabasePool(baseUrl.toString());
    dbName = `stratafetch_test_repo_${randomUUID().replace(/-/g, "")}`;
    await adminPool.query(`CREATE DATABASE ${dbName}`);

    const dbUrl = new URL(baseUrl.toString());
    dbUrl.pathname = `/${dbName}`;
    pool = createDatabasePool(dbUrl.toString());
    await runMigrations(pool);
    repo = new OperationRepository(pool, 30);
  });

  afterEach(async () => {
    await pool.query("TRUNCATE operations, collections CASCADE");
  });

  afterAll(async () => {
    await pool.end();
    await adminPool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await adminPool.end();
  });

  async function insertCollectionFor(operationId: string) {
    await pool.query(
      `INSERT INTO collections
         (id, status, max_pages, mode, outputs, timeout_ms, wait_after_load_ms, operation_id)
       VALUES ($1, 'queued', 10, 'http', '["text"]'::jsonb, 30000, 0, $2)`,
      [randomUUID(), operationId],
    );
  }

  describe("create", () => {
    it("replays the stored result for a repeated idempotency key with the same request", async () => {
      const key = randomUUID();
      const request = { url: "https://example.com" };
      const first = await repo.create("fetch", request, {
        idempotencyKey: key,
      });
      expect(first.isNew).toBe(true);

      const second = await repo.create("fetch", request, {
        idempotencyKey: key,
      });
      expect(second.isNew).toBe(false);
      expect(second.operation.id).toBe(first.operation.id);
    });

    it("rejects a repeated idempotency key with a different request", async () => {
      const key = randomUUID();
      await repo.create(
        "fetch",
        { url: "https://example.com/a" },
        {
          idempotencyKey: key,
        },
      );

      await expect(
        repo.create(
          "fetch",
          { url: "https://example.com/b" },
          {
            idempotencyKey: key,
          },
        ),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    });

    it("rejects a repeated idempotency key used with a different operation type", async () => {
      const key = randomUUID();
      await repo.create(
        "fetch",
        { url: "https://example.com" },
        {
          idempotencyKey: key,
        },
      );

      await expect(
        repo.create(
          "survey",
          { startUrl: "https://example.com" },
          {
            idempotencyKey: key,
          },
        ),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    });

    it("computes contentExpiresAt from the configured retention window", async () => {
      const before = Date.now();
      const { operation } = await repo.create("fetch", {
        url: "https://example.com",
      });
      const after = Date.now();

      expect(operation.contentExpiresAt).not.toBeNull();
      const expiresAt = new Date(operation.contentExpiresAt!).getTime();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      expect(expiresAt).toBeGreaterThanOrEqual(before + thirtyDaysMs - 5_000);
      expect(expiresAt).toBeLessThanOrEqual(after + thirtyDaysMs + 5_000);
    });

    it("allows exactly one create to win a race on the same idempotency key", async () => {
      const key = randomUUID();
      const request = { url: "https://example.com" };
      const results = await Promise.all([
        repo.create("fetch", request, { idempotencyKey: key }),
        repo.create("fetch", request, { idempotencyKey: key }),
      ]);
      const isNewCount = results.filter((r) => r.isNew).length;
      expect(isNewCount).toBe(1);
      expect(results[0]!.operation.id).toBe(results[1]!.operation.id);
    });
  });

  describe("cancel", () => {
    it("cancels a queued operation and its linked collection", async () => {
      const { operation } = await repo.create("collection", {
        source: { type: "urls", urls: ["https://example.com"] },
      });
      await insertCollectionFor(operation.id);

      const cancelled = await repo.cancel(operation.id);
      expect(cancelled?.status).toBe("cancelled");
      expect(cancelled?.cancelRequested).toBe(true);
      expect(cancelled?.completedAt).not.toBeNull();

      const collection = await pool.query<{ status: string }>(
        "SELECT status FROM collections WHERE operation_id=$1",
        [operation.id],
      );
      expect(collection.rows[0]?.status).toBe("cancelled");
    });

    it("flags a running operation for cancellation without changing its status", async () => {
      const { operation } = await repo.create("fetch", {
        url: "https://example.com",
      });
      await repo.markRunning(operation.id);

      const result = await repo.cancel(operation.id);
      expect(result?.status).toBe("running");
      expect(result?.cancelRequested).toBe(true);
      expect(result?.completedAt).toBeNull();
    });

    it("returns null for an unknown operation id", async () => {
      const result = await repo.cancel(randomUUID());
      expect(result).toBeNull();
    });
  });

  describe("list", () => {
    it("paginates with nextCursor when more rows exist than the limit", async () => {
      for (let i = 0; i < 3; i++) {
        await repo.create("fetch", { url: `https://example.com/${i}` });
      }

      const page = await repo.list(undefined, 2);
      expect(page.data).toHaveLength(2);
      expect(page.nextCursor).not.toBeNull();

      const nextPage = await repo.list(page.nextCursor!, 2);
      expect(nextPage.data.length).toBeGreaterThan(0);
      expect(
        nextPage.data.every((op) => !page.data.some((p) => p.id === op.id)),
      ).toBe(true);
    });
  });

  describe("expireContent", () => {
    it("clears result content past its expiry", async () => {
      const { operation } = await repo.create("fetch", {
        url: "https://example.com",
      });
      await repo.complete(operation.id, { data: "content" });
      await pool.query(
        "UPDATE operations SET content_expires_at = now() - interval '1 day' WHERE id=$1",
        [operation.id],
      );

      await repo.expireContent();

      const after = await repo.get(operation.id);
      expect(after?.result).toBeNull();
    });

    it("leaves unexpired content untouched", async () => {
      const { operation } = await repo.create("fetch", {
        url: "https://example.com",
      });
      await repo.complete(operation.id, { data: "content" });

      await repo.expireContent();

      const after = await repo.get(operation.id);
      expect(after?.result).toEqual({ data: "content" });
    });
  });
});
