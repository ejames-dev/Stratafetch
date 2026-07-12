import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  OperationRecord,
  OperationStatus,
  OperationType,
} from "@stratafetch/contracts";
import type { DatabasePool } from "../database/pool.js";
import { AppError } from "../errors.js";

interface Row {
  id: string;
  type: OperationType;
  status: OperationStatus;
  request: unknown;
  result: unknown | null;
  error: { code: string; message: string } | null;
  provider: string | null;
  usage: Record<string, unknown> | null;
  cancel_requested: boolean;
  content_expires_at: Date | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}
const map = (r: Row): OperationRecord => ({
  id: r.id,
  type: r.type,
  status: r.status,
  request: r.request,
  result: r.result,
  error: r.error,
  provider: r.provider,
  usage: r.usage,
  cancelRequested: r.cancel_requested,
  contentExpiresAt: r.content_expires_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
  startedAt: r.started_at?.toISOString() ?? null,
  completedAt: r.completed_at?.toISOString() ?? null,
});

function replay(row: Row, type: OperationType, request: unknown) {
  if (row.type !== type || !isDeepStrictEqual(row.request, request)) {
    throw new AppError(
      "This Idempotency-Key was already used with a different request.",
      409,
      "IDEMPOTENCY_CONFLICT",
    );
  }
  return { operation: map(row), isNew: false };
}

export class OperationRepository {
  constructor(
    private readonly pool: DatabasePool,
    private readonly retentionDays = 30,
  ) {}
  async create(
    type: OperationType,
    request: unknown,
    options: {
      idempotencyKey?: string | undefined;
      provider?: string | undefined;
    } = {},
  ) {
    if (options.idempotencyKey) {
      const found = await this.pool.query<Row>(
        "SELECT * FROM operations WHERE idempotency_key=$1",
        [options.idempotencyKey],
      );
      if (found.rows[0]) return replay(found.rows[0], type, request);
    }
    try {
      const out = await this.pool.query<Row>(
        `INSERT INTO operations(id,type,status,request,provider,idempotency_key,content_expires_at) VALUES($1,$2,'queued',$3::jsonb,$4,$5,now()+($6||' days')::interval) RETURNING *`,
        [
          randomUUID(),
          type,
          JSON.stringify(request),
          options.provider ?? null,
          options.idempotencyKey ?? null,
          this.retentionDays,
        ],
      );
      return { operation: map(out.rows[0]!), isNew: true };
    } catch (error) {
      if (options.idempotencyKey) {
        const found = await this.pool.query<Row>(
          "SELECT * FROM operations WHERE idempotency_key=$1",
          [options.idempotencyKey],
        );
        if (found.rows[0]) return replay(found.rows[0], type, request);
      }
      throw error;
    }
  }
  async get(id: string) {
    const out = await this.pool.query<Row>(
      "SELECT * FROM operations WHERE id=$1",
      [id],
    );
    return out.rows[0] ? map(out.rows[0]) : null;
  }
  async list(
    cursor?: string,
    limit = 50,
    type?: OperationType,
    status?: OperationStatus,
  ) {
    const values: unknown[] = [];
    const where: string[] = [];
    if (cursor) {
      values.push(new Date(cursor));
      where.push(`created_at < $${values.length}`);
    }
    if (type) {
      values.push(type);
      where.push(`type=$${values.length}`);
    }
    if (status) {
      values.push(status);
      where.push(`status=$${values.length}`);
    }
    values.push(limit + 1);
    const out = await this.pool.query<Row>(
      `SELECT * FROM operations ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC,id DESC LIMIT $${values.length}`,
      values,
    );
    const hasMore = out.rows.length > limit;
    const data = out.rows.slice(0, limit).map(map);
    return {
      data,
      nextCursor: hasMore ? (data.at(-1)?.createdAt ?? null) : null,
    };
  }
  async markRunning(id: string) {
    await this.pool.query(
      "UPDATE operations SET status='running',started_at=COALESCE(started_at,now()) WHERE id=$1",
      [id],
    );
  }
  async complete(id: string, result: unknown, usage?: Record<string, unknown>) {
    await this.pool.query(
      "UPDATE operations SET status='completed',result=$2::jsonb,usage=$3::jsonb,completed_at=now() WHERE id=$1",
      [id, JSON.stringify(result), usage ? JSON.stringify(usage) : null],
    );
  }
  async fail(id: string, code: string, message: string) {
    await this.pool.query(
      "UPDATE operations SET status='failed',error=$2::jsonb,completed_at=now() WHERE id=$1",
      [id, JSON.stringify({ code, message })],
    );
  }
  async markCancelled(id: string) {
    await this.pool.query(
      "UPDATE operations SET status='cancelled',cancel_requested=true,completed_at=now() WHERE id=$1",
      [id],
    );
  }
  async cancel(id: string) {
    const out = await this.pool.query<Row>(
      `UPDATE operations SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,completed_at=CASE WHEN status='queued' THEN now() ELSE completed_at END WHERE id=$1 RETURNING *`,
      [id],
    );
    if (out.rows[0]?.status === "cancelled") {
      await this.pool.query(
        "UPDATE collections SET status='cancelled',completed_at=now() WHERE operation_id=$1 AND status='queued'",
        [id],
      );
    }
    return out.rows[0] ? map(out.rows[0]) : null;
  }
  async isCancellationRequested(id: string) {
    const out = await this.pool.query<{ cancel_requested: boolean }>(
      "SELECT cancel_requested FROM operations WHERE id=$1",
      [id],
    );
    return out.rows[0]?.cancel_requested ?? true;
  }
  async delete(id: string) {
    return (
      ((await this.pool.query("DELETE FROM operations WHERE id=$1", [id]))
        .rowCount ?? 0) > 0
    );
  }
  async expireContent() {
    await this.pool.query(
      "UPDATE operations SET result=NULL WHERE result IS NOT NULL AND content_expires_at<=now()",
    );
    await this.pool.query(
      "UPDATE collection_pages SET content=NULL WHERE content IS NOT NULL AND content_expires_at<=now()",
    );
  }
}
