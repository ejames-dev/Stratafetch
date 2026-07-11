import { randomUUID } from "node:crypto";
import type {
  CollectionPageRecord,
  CollectionPageStatus,
  CollectionRecord,
  CollectionRequest,
  FetchResponse
} from "@stratafetch/contracts";
import type { DatabasePool } from "../database/pool.js";

interface CollectionRow {
  id: string;
  status: CollectionRecord["status"];
  start_url: string;
  max_pages: number;
  mode: CollectionRequest["mode"];
  outputs: CollectionRequest["outputs"];
  timeout_ms: number;
  wait_after_load_ms: number;
  discovered_pages: number;
  processed_pages: number;
  failed_pages: number;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}
interface CollectionPageRow {
  id: string;
  collection_id: string;
  url: string;
  status: CollectionPageStatus;
  source: FetchResponse["data"]["source"] | null;
  content: FetchResponse["data"]["content"] | null;
  error: string | null;
  created_at: Date;
}

function toCollection(row: CollectionRow): CollectionRecord {
  return {
    id: row.id,
    status: row.status,
    startUrl: row.start_url,
    maxPages: row.max_pages,
    mode: row.mode,
    outputs: row.outputs,
    timeoutMs: row.timeout_ms,
    waitAfterLoadMs: row.wait_after_load_ms,
    discoveredPages: row.discovered_pages,
    processedPages: row.processed_pages,
    failedPages: row.failed_pages,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null
  };
}

function toPage(row: CollectionPageRow): CollectionPageRecord {
  return {
    id: row.id,
    collectionId: row.collection_id,
    url: row.url,
    status: row.status,
    source: row.source,
    content: row.content,
    error: row.error,
    createdAt: row.created_at.toISOString()
  };
}

export interface CollectionRepository {
  create(request: CollectionRequest): Promise<CollectionRecord>;
  get(id: string): Promise<CollectionRecord | null>;
  listPages(id: string): Promise<CollectionPageRecord[]>;
  markRunning(id: string): Promise<void>;
  markCompleted(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  setProgress(id: string, discovered: number, processed: number, failed: number): Promise<void>;
  savePage(input: {
    collectionId: string;
    url: string;
    status: CollectionPageStatus;
    source: FetchResponse["data"]["source"] | null;
    content: FetchResponse["data"]["content"] | null;
    error: string | null;
  }): Promise<void>;
}

export class PostgresCollectionRepository implements CollectionRepository {
  constructor(private readonly pool: DatabasePool) {}

  async create(request: CollectionRequest): Promise<CollectionRecord> {
    const id = randomUUID();
    const result = await this.pool.query<CollectionRow>(`
      INSERT INTO collections (
        id, status, start_url, max_pages, mode, outputs, timeout_ms, wait_after_load_ms
      ) VALUES ($1, 'queued', $2, $3, $4, $5::jsonb, $6, $7)
      RETURNING *
    `, [
      id,
      request.startUrl,
      request.maxPages,
      request.mode,
      JSON.stringify(request.outputs),
      request.timeoutMs,
      request.waitAfterLoadMs
    ]);
    return toCollection(result.rows[0]!);
  }

  async get(id: string): Promise<CollectionRecord | null> {
    const result = await this.pool.query<CollectionRow>(
      "SELECT * FROM collections WHERE id = $1",
      [id]
    );
    return result.rows[0] ? toCollection(result.rows[0]) : null;
  }

  async listPages(id: string): Promise<CollectionPageRecord[]> {
    const result = await this.pool.query<CollectionPageRow>(
      "SELECT * FROM collection_pages WHERE collection_id = $1 ORDER BY created_at, id",
      [id]
    );
    return result.rows.map(toPage);
  }

  async markRunning(id: string): Promise<void> {
    await this.pool.query(
      "UPDATE collections SET status = 'running', started_at = now(), error = NULL WHERE id = $1",
      [id]
    );
  }

  async markCompleted(id: string): Promise<void> {
    await this.pool.query(
      "UPDATE collections SET status = 'completed', completed_at = now() WHERE id = $1",
      [id]
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.pool.query(
      "UPDATE collections SET status = 'failed', error = $2, completed_at = now() WHERE id = $1",
      [id, error]
    );
  }

  async setProgress(id: string, discovered: number, processed: number, failed: number): Promise<void> {
    await this.pool.query(`
      UPDATE collections
      SET discovered_pages = $2, processed_pages = $3, failed_pages = $4
      WHERE id = $1
    `, [id, discovered, processed, failed]);
  }

  async savePage(input: Parameters<CollectionRepository["savePage"]>[0]): Promise<void> {
    await this.pool.query(`
      INSERT INTO collection_pages (id, collection_id, url, status, source, content, error)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
      ON CONFLICT (collection_id, url) DO UPDATE SET
        status = EXCLUDED.status,
        source = EXCLUDED.source,
        content = EXCLUDED.content,
        error = EXCLUDED.error
    `, [
      randomUUID(),
      input.collectionId,
      input.url,
      input.status,
      input.source ? JSON.stringify(input.source) : null,
      input.content ? JSON.stringify(input.content) : null,
      input.error
    ]);
  }
}
