import { randomUUID } from "node:crypto";
import type {
  OperationStatus,
  SurveyRequest,
  SurveyUrlRecord,
} from "@stratafetch/contracts";
import type { DatabasePool } from "../database/pool.js";
export interface SurveyRecord {
  id: string;
  operationId: string;
  status: OperationStatus;
  request: SurveyRequest;
  createdAt: string;
}
export class SurveyRepository {
  constructor(private readonly pool: DatabasePool) {}
  async create(operationId: string) {
    const id = randomUUID();
    await this.pool.query(
      "INSERT INTO surveys(id,operation_id) VALUES($1,$2)",
      [id, operationId],
    );
    return id;
  }
  async get(id: string) {
    const out = await this.pool.query<{
      id: string;
      operation_id: string;
      status: OperationStatus;
      request: SurveyRequest;
      created_at: Date;
    }>(
      "SELECT s.id,s.operation_id,o.status,o.request,s.created_at FROM surveys s JOIN operations o ON o.id=s.operation_id WHERE s.id=$1",
      [id],
    );
    const r = out.rows[0];
    return r
      ? {
          id: r.id,
          operationId: r.operation_id,
          status: r.status,
          request: r.request,
          createdAt: r.created_at.toISOString(),
        }
      : null;
  }
  async getByOperationId(operationId: string) {
    const out = await this.pool.query<{ id: string }>(
      "SELECT id FROM surveys WHERE operation_id=$1",
      [operationId],
    );
    return out.rows[0] ?? null;
  }
  async saveUrl(
    surveyId: string,
    url: string,
    source: SurveyUrlRecord["source"],
    parentUrl: string | null,
    depth: number,
    robotsAllowed: boolean,
  ) {
    await this.pool.query(
      "INSERT INTO survey_urls(id,survey_id,url,source,parent_url,depth,robots_allowed) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(survey_id,url) DO NOTHING",
      [randomUUID(), surveyId, url, source, parentUrl, depth, robotsAllowed],
    );
  }
  async listUrls(id: string, limit = 100, cursor?: string) {
    const values: unknown[] = [id];
    let extra = "";
    if (cursor) {
      values.push(new Date(cursor));
      extra = `AND created_at > $${values.length}`;
    }
    values.push(limit + 1);
    const out = await this.pool.query<{
      id: string;
      survey_id: string;
      url: string;
      source: SurveyUrlRecord["source"];
      parent_url: string | null;
      depth: number;
      robots_allowed: boolean;
      created_at: Date;
    }>(
      `SELECT * FROM survey_urls WHERE survey_id=$1 ${extra} ORDER BY created_at,id LIMIT $${values.length}`,
      values,
    );
    const data = out.rows.slice(0, limit).map((r) => ({
      id: r.id,
      surveyId: r.survey_id,
      url: r.url,
      source: r.source,
      parentUrl: r.parent_url,
      depth: r.depth,
      robotsAllowed: r.robots_allowed,
      createdAt: r.created_at.toISOString(),
    }));
    return {
      data,
      nextCursor:
        out.rows.length > limit ? (data.at(-1)?.createdAt ?? null) : null,
    };
  }
  async allUrls(id: string) {
    const out = await this.pool.query<{ url: string }>(
      "SELECT url FROM survey_urls WHERE survey_id=$1 AND robots_allowed=true ORDER BY created_at,id",
      [id],
    );
    return out.rows.map((r) => r.url);
  }
  async countUrls(id: string) {
    const out = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM survey_urls WHERE survey_id=$1 AND robots_allowed=true",
      [id],
    );
    return Number(out.rows[0]?.count ?? 0);
  }
}
