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
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE operations (
        id uuid PRIMARY KEY,
        type text NOT NULL CHECK (type IN ('fetch', 'survey', 'collection', 'search', 'shape')),
        status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        request jsonb NOT NULL,
        result jsonb,
        error jsonb,
        provider text,
        usage jsonb,
        idempotency_key text,
        cancel_requested boolean NOT NULL DEFAULT false,
        content_expires_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,
        completed_at timestamptz
      );
      CREATE UNIQUE INDEX operations_idempotency_idx
        ON operations (idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX operations_created_idx ON operations (created_at DESC, id DESC);
      CREATE INDEX operations_status_idx ON operations (status, created_at);

      CREATE TABLE api_keys (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        key_prefix text NOT NULL,
        key_hash text NOT NULL UNIQUE,
        scopes jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz,
        revoked_at timestamptz
      );

      CREATE TABLE surveys (
        id uuid PRIMARY KEY,
        operation_id uuid NOT NULL UNIQUE REFERENCES operations(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE survey_urls (
        id uuid PRIMARY KEY,
        survey_id uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
        url text NOT NULL,
        source text NOT NULL CHECK (source IN ('seed', 'sitemap', 'link')),
        parent_url text,
        depth integer NOT NULL,
        robots_allowed boolean NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (survey_id, url)
      );
      CREATE INDEX survey_urls_survey_created_idx ON survey_urls (survey_id, created_at, id);

      CREATE TABLE searches (
        id uuid PRIMARY KEY,
        operation_id uuid NOT NULL UNIQUE REFERENCES operations(id) ON DELETE CASCADE,
        provider text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE shapes (
        id uuid PRIMARY KEY,
        operation_id uuid NOT NULL UNIQUE REFERENCES operations(id) ON DELETE CASCADE,
        provider text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      ALTER TABLE collections ALTER COLUMN start_url DROP NOT NULL;
      ALTER TABLE collections ADD COLUMN operation_id uuid UNIQUE REFERENCES operations(id) ON DELETE CASCADE;
      ALTER TABLE collections ADD COLUMN source jsonb;
      ALTER TABLE collections ADD COLUMN robots_policy text NOT NULL DEFAULT 'respect';
      ALTER TABLE collections ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false;
      ALTER TABLE collection_pages ADD COLUMN content_expires_at timestamptz;
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE collections DROP CONSTRAINT IF EXISTS collections_status_check;
      ALTER TABLE collections ADD CONSTRAINT collections_status_check
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled'));
      ALTER TABLE collections DROP CONSTRAINT IF EXISTS collections_max_pages_check;
      ALTER TABLE collections ADD CONSTRAINT collections_max_pages_check
        CHECK (max_pages BETWEEN 1 AND 1000);
    `,
  },
] as const;

export async function runMigrations(pool: DatabasePool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('stratafetch-migrations'))",
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS stratafetch_migrations (
        version integer PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = await client.query<{ version: number }>(
      "SELECT version FROM stratafetch_migrations",
    );
    const versions = new Set(applied.rows.map(({ version }) => version));
    for (const migration of migrations) {
      if (versions.has(migration.version)) continue;
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO stratafetch_migrations (version) VALUES ($1)",
        [migration.version],
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
