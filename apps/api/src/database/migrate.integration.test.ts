import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabasePool, type DatabasePool } from "./pool.js";
import { runMigrations } from "./migrate.js";

// Real Postgres only: the idempotency/DDL behaviour under test can't be
// meaningfully faked. Skips locally without DATABASE_URL, but fails loudly
// rather than silently passing if CI's env wiring for the `integration` job
// ever breaks (see .github/workflows/ci.yml).
const shouldRun = Boolean(process.env.DATABASE_URL) || Boolean(process.env.CI);

describe.skipIf(!shouldRun)("runMigrations", () => {
  let adminPool: DatabasePool;
  let pool: DatabasePool;
  let dbName: string;
  let dbConnectionString: string;

  beforeAll(async () => {
    const baseUrl = new URL(
      process.env.DATABASE_URL ??
        "postgresql://stratafetch:stratafetch@localhost:5432/stratafetch",
    );
    adminPool = createDatabasePool(baseUrl.toString());
    dbName = `stratafetch_test_migrate_${randomUUID().replace(/-/g, "")}`;
    await adminPool.query(`CREATE DATABASE ${dbName}`);

    const dbUrl = new URL(baseUrl.toString());
    dbUrl.pathname = `/${dbName}`;
    dbConnectionString = dbUrl.toString();
    pool = createDatabasePool(dbConnectionString);
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

  it("applies all migrations in order to a fresh database", async () => {
    await runMigrations(pool);

    const applied = await pool.query<{ version: number }>(
      "SELECT version FROM stratafetch_migrations ORDER BY version",
    );
    expect(applied.rows.map((r) => r.version)).toEqual([1, 2, 3]);

    const tables = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        "collections",
        "collection_pages",
        "operations",
        "api_keys",
        "surveys",
        "survey_urls",
        "searches",
        "shapes",
        "stratafetch_migrations",
      ]),
    );
  });

  it("is a no-op on a second run", async () => {
    await runMigrations(pool);
    await runMigrations(pool);

    const applied = await pool.query<{ version: number }>(
      "SELECT version FROM stratafetch_migrations",
    );
    expect(applied.rows).toHaveLength(3);
  });

  it("does not deadlock or double-apply under concurrent callers", async () => {
    // Exercises the pg_advisory_xact_lock in runMigrations: two pools racing
    // to migrate the same fresh database should serialize, not collide.
    const poolA = createDatabasePool(dbConnectionString);
    const poolB = createDatabasePool(dbConnectionString);
    try {
      await Promise.all([runMigrations(poolA), runMigrations(poolB)]);

      const applied = await pool.query<{ version: number }>(
        "SELECT version FROM stratafetch_migrations",
      );
      expect(applied.rows).toHaveLength(3);
    } finally {
      await poolA.end();
      await poolB.end();
    }
  });
});
