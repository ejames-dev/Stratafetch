import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { ApiKeyScope } from "@stratafetch/contracts";
import type { DatabasePool } from "../database/pool.js";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export class AuthService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly adminToken: string,
  ) {}
  isAdminToken(token: string) {
    const a = Buffer.from(hash(token));
    const b = Buffer.from(hash(this.adminToken));
    return a.length === b.length && timingSafeEqual(a, b);
  }
  createSession() {
    const expires = Date.now() + 8 * 60 * 60 * 1_000;
    const payload = String(expires);
    const signature = createHmac("sha256", this.adminToken)
      .update(payload)
      .digest("hex");
    return { value: `${payload}.${signature}`, expires };
  }
  validateSession(value?: string) {
    if (!value) return false;
    const [payload, signature] = value.split(".");
    if (!payload || !signature || Number(payload) < Date.now()) return false;
    const expected = createHmac("sha256", this.adminToken)
      .update(payload)
      .digest("hex");
    return (
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    );
  }
  async createKey(name: string, scopes: ApiKeyScope[]) {
    const secret = `sf_${randomBytes(32).toString("base64url")}`;
    const id = randomUUID();
    const prefix = secret.slice(0, 11);
    await this.pool.query(
      "INSERT INTO api_keys(id,name,key_prefix,key_hash,scopes) VALUES($1,$2,$3,$4,$5::jsonb)",
      [id, name, prefix, hash(secret), JSON.stringify(scopes)],
    );
    return { id, name, prefix, scopes, secret };
  }
  async authorize(token: string, required: ApiKeyScope) {
    if (this.isAdminToken(token)) return true;
    const out = await this.pool.query<{ id: string; scopes: ApiKeyScope[] }>(
      "SELECT id,scopes FROM api_keys WHERE key_hash=$1 AND revoked_at IS NULL",
      [hash(token)],
    );
    const row = out.rows[0];
    if (
      !row ||
      (!row.scopes.includes(required) && !row.scopes.includes("admin"))
    )
      return false;
    await this.pool.query(
      "UPDATE api_keys SET last_used_at=now() WHERE id=$1",
      [row.id],
    );
    return true;
  }
  async listKeys() {
    const out = await this.pool.query(
      'SELECT id,name,key_prefix AS prefix,scopes,created_at AS "createdAt",last_used_at AS "lastUsedAt",revoked_at AS "revokedAt" FROM api_keys ORDER BY created_at DESC',
    );
    return out.rows;
  }
  async revoke(id: string) {
    return (
      ((
        await this.pool.query(
          "UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL",
          [id],
        )
      ).rowCount ?? 0) > 0
    );
  }
}
