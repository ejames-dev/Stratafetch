export type OperationStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled";
export type Capability = "fetch" | "survey" | "collect" | "search" | "shape";
export type OperationType =
  "fetch" | "survey" | "collection" | "search" | "shape";

export interface Operation {
  id: string;
  type: OperationType;
  status: OperationStatus;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  progress?: { current: number; total?: number; label?: string };
  error?: { code: string; message: string };
  contentExpiresAt?: string | null;
  request?: unknown;
  result?: unknown | null;
  provider?: string | null;
  usage?: Record<string, unknown> | null;
}

export interface OperationList {
  data: Operation[];
  nextCursor?: string | null;
}

export interface Health {
  status: "ok" | "degraded" | "unavailable";
  version?: string;
  services?: Record<string, "ok" | "unavailable">;
  providers?: Record<string, boolean>;
  retentionDays?: number;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix?: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}
