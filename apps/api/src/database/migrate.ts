import type { DatabasePool } from "./pool.js";

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE collections (
        id uuid PRIMARY KEY,
        status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
        start_url text NOT NULL,
        max_pages integer NOT NULL CHECK (max_pages BETWEEN 1 AND 100),
        mode text NOT NULL CHECK (mode IN ('http', 'browser')),
        outputs jsonb NOT NULL,
        timeout_ms integer NOT NULL,
        wait_after_load_ms integer NOT NULL,
        discovered_pages integer NOT NULL DEFAULT 1,
        processed_pages integer NOT NULL DEFAULT 0,
        failed_pages integer NOT NULL DEFAULT 0,
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,
        completed_at timestamptz
      );

      CREATE TABLE collection_pages (
        id uuid PRIMARY KEY,
        collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        url text NOT NULL,
        status text NOT NULL CHECK (status IN ('completed', 'failed')),
        source jsonb,
        content jsonb,
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (collection_id, url)
      );

      CREATE INDEX collection_pages_collection_created_idx
        ON collection_pages (collection_id, created_at);
      CREATE INDEX collections_created_idx ON collections (created_at DESC);
    `
  }
] as const;

export async function runMigrations(pool: DatabasePool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('stratafetch-migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS stratafetch_migrations (
        version integer PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = await client.query<{ version: number }>(
      "SELECT version FROM stratafetch_migrations"
    );
    const versions = new Set(applied.rows.map(({ version }) => version));
    for (const migration of migrations) {
      if (versions.has(migration.version)) continue;
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO stratafetch_migrations (version) VALUES ($1)",
        [migration.version]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
