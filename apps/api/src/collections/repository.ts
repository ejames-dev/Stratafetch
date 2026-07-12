import { randomUUID } from "node:crypto";
import type {
  CollectionPageRecord,
  CollectionPageStatus,
  CollectionRecord,
  CollectionRequest,
  FetchResponse,
  OperationStatus,
} from "@stratafetch/contracts";
import type { DatabasePool } from "../database/pool.js";
interface Row {
  id: string;
  operation_id: string;
  status: OperationStatus;
  source: CollectionRequest["source"];
  mode: CollectionRequest["mode"];
  outputs: CollectionRequest["outputs"];
  timeout_ms: number;
  wait_after_load_ms: number;
  robots_policy: CollectionRequest["robotsPolicy"];
  discovered_pages: number;
  processed_pages: number;
  failed_pages: number;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}
interface PageRow {
  id: string;
  collection_id: string;
  url: string;
  status: CollectionPageStatus;
  source: FetchResponse["data"]["source"] | null;
  content: FetchResponse["data"]["content"] | null;
  error: string | null;
  created_at: Date;
}
const map = (r: Row): CollectionRecord => ({
  id: r.id,
  operationId: r.operation_id,
  status: r.status,
  source: r.source,
  mode: r.mode,
  outputs: r.outputs,
  timeoutMs: r.timeout_ms,
  waitAfterLoadMs: r.wait_after_load_ms,
  robotsPolicy: r.robots_policy,
  discoveredPages: r.discovered_pages,
  processedPages: r.processed_pages,
  failedPages: r.failed_pages,
  error: r.error,
  createdAt: r.created_at.toISOString(),
  startedAt: r.started_at?.toISOString() ?? null,
  completedAt: r.completed_at?.toISOString() ?? null,
});
const mapPage = (r: PageRow): CollectionPageRecord => ({
  id: r.id,
  collectionId: r.collection_id,
  url: r.url,
  status: r.status,
  source: r.source,
  content: r.content,
  error: r.error,
  createdAt: r.created_at.toISOString(),
});
export class PostgresCollectionRepository {
  constructor(private readonly pool: DatabasePool) {}
  async create(operationId: string, request: CollectionRequest, count: number) {
    const id = randomUUID();
    const out = await this.pool.query<Row>(
      `INSERT INTO collections(id,operation_id,status,start_url,max_pages,mode,outputs,timeout_ms,wait_after_load_ms,source,robots_policy,discovered_pages) VALUES($1,$2,'queued',NULL,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9,$3) RETURNING *`,
      [
        id,
        operationId,
        count,
        request.mode,
        JSON.stringify(request.outputs),
        request.timeoutMs,
        request.waitAfterLoadMs,
        JSON.stringify(request.source),
        request.robotsPolicy,
      ],
    );
    return map(out.rows[0]!);
  }
  async get(id: string) {
    const out = await this.pool.query<Row>(
      "SELECT * FROM collections WHERE id=$1",
      [id],
    );
    return out.rows[0] ? map(out.rows[0]) : null;
  }
  async getByOperationId(operationId: string) {
    const out = await this.pool.query<Row>(
      "SELECT * FROM collections WHERE operation_id=$1",
      [operationId],
    );
    return out.rows[0] ? map(out.rows[0]) : null;
  }
  async listPages(id: string, limit = 100, cursor?: string) {
    const values: unknown[] = [id];
    let extra = "";
    if (cursor) {
      values.push(new Date(cursor));
      extra = `AND created_at > $${values.length}`;
    }
    values.push(limit + 1);
    const out = await this.pool.query<PageRow>(
      `SELECT * FROM collection_pages WHERE collection_id=$1 ${extra} ORDER BY created_at,id LIMIT $${values.length}`,
      values,
    );
    const hasMore = out.rows.length > limit;
    const data = out.rows.slice(0, limit).map(mapPage);
    return {
      data,
      nextCursor: hasMore ? (data.at(-1)?.createdAt ?? null) : null,
    };
  }
  async updateStatus(
    id: string,
    status: OperationStatus,
    error: string | null = null,
  ) {
    await this.pool.query(
      "UPDATE collections SET status=$2,error=$3,started_at=CASE WHEN $2='running' THEN COALESCE(started_at,now()) ELSE started_at END,completed_at=CASE WHEN $2 IN ('completed','failed','cancelled') THEN now() ELSE completed_at END WHERE id=$1",
      [id, status, error],
    );
  }
  async setProgress(id: string, processed: number, failed: number) {
    await this.pool.query(
      "UPDATE collections SET processed_pages=$2,failed_pages=$3 WHERE id=$1",
      [id, processed, failed],
    );
  }
  async savePage(input: {
    collectionId: string;
    url: string;
    status: CollectionPageStatus;
    source: FetchResponse["data"]["source"] | null;
    content: FetchResponse["data"]["content"] | null;
    error: string | null;
    expiresAt: string | null;
  }) {
    await this.pool.query(
      `INSERT INTO collection_pages(id,collection_id,url,status,source,content,error,content_expires_at) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8) ON CONFLICT(collection_id,url) DO UPDATE SET status=EXCLUDED.status,source=EXCLUDED.source,content=EXCLUDED.content,error=EXCLUDED.error,content_expires_at=EXCLUDED.content_expires_at`,
      [
        randomUUID(),
        input.collectionId,
        input.url,
        input.status,
        input.source ? JSON.stringify(input.source) : null,
        input.content ? JSON.stringify(input.content) : null,
        input.error,
        input.expiresAt,
      ],
    );
  }
}
