import { z } from "zod";

export const apiKeyScopeSchema = z.enum([
  "fetch",
  "survey",
  "collect",
  "search",
  "shape",
  "admin",
]);
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;

export const operationTypeSchema = z.enum([
  "fetch",
  "survey",
  "collection",
  "search",
  "shape",
]);
export const operationStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type OperationType = z.infer<typeof operationTypeSchema>;
export type OperationStatus = z.infer<typeof operationStatusSchema>;

export const robotsPolicySchema = z
  .enum(["respect", "ignore"])
  .default("respect");
export const retrievalModeSchema = z.enum(["http", "browser"]).default("http");
export const fetchOutputSchema = z.enum(["markdown", "text", "html", "links"]);
export type FetchOutput = z.infer<typeof fetchOutputSchema>;

export const fetchRequestSchema = z.object({
  url: z.url(),
  mode: retrievalModeSchema,
  outputs: z
    .array(fetchOutputSchema)
    .min(1)
    .default(["markdown", "text", "links"]),
  timeoutMs: z.number().int().min(1_000).max(60_000).default(30_000),
  waitAfterLoadMs: z.number().int().min(0).max(10_000).default(0),
  robotsPolicy: robotsPolicySchema,
});
export type FetchRequest = z.infer<typeof fetchRequestSchema>;

export interface FetchResponse {
  operationId?: string;
  data: {
    source: {
      requestedUrl: string;
      resolvedUrl: string;
      status: number;
      contentType: string;
      robotsAllowed?: boolean;
    };
    content: Partial<Record<FetchOutput, string | string[]>>;
    retrieval: {
      mode: "http" | "browser";
      fetchedAt: string;
      durationMs: number;
    };
  };
}

export const surveyRequestSchema = z.object({
  startUrl: z.url(),
  maxUrls: z.number().int().min(1).max(10_000).default(1_000),
  maxDepth: z.number().int().min(0).max(20).default(5),
  include: z.array(z.string().min(1)).max(50).default([]),
  exclude: z.array(z.string().min(1)).max(50).default([]),
  includeSubdomains: z.boolean().default(false),
  mode: retrievalModeSchema,
  robotsPolicy: robotsPolicySchema,
});
export type SurveyRequest = z.infer<typeof surveyRequestSchema>;

export const collectionSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("survey"), surveyId: z.uuid() }),
  z.object({
    type: z.literal("urls"),
    urls: z.array(z.url()).min(1).max(1_000),
  }),
]);
export const collectionRequestSchema = z.object({
  source: collectionSourceSchema,
  mode: retrievalModeSchema,
  outputs: z.array(fetchOutputSchema).min(1).default(["markdown", "text"]),
  timeoutMs: z.number().int().min(1_000).max(60_000).default(30_000),
  waitAfterLoadMs: z.number().int().min(0).max(10_000).default(0),
  robotsPolicy: robotsPolicySchema,
});
export type CollectionRequest = z.infer<typeof collectionRequestSchema>;

export const searchRequestSchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(20).default(10),
  country: z.string().trim().length(2).optional(),
  language: z.string().trim().min(2).max(10).optional(),
  freshness: z.enum(["day", "week", "month", "year"]).optional(),
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export interface SearchResult {
  rank: number;
  title: string;
  url: string;
  description: string;
  publishedAt?: string;
  provider: "brave";
}

export const shapeSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fetch"), fetchId: z.uuid() }),
  z.object({
    type: z.literal("collection"),
    collectionId: z.uuid(),
    pageIds: z.array(z.uuid()).max(1_000).optional(),
  }),
  z.object({
    type: z.literal("inline"),
    content: z.string().min(1).max(2_000_000),
  }),
]);
export const shapeRequestSchema = z.object({
  source: shapeSourceSchema,
  schema: z.record(z.string(), z.unknown()),
  instructions: z.string().trim().max(10_000).optional(),
});
export type ShapeRequest = z.infer<typeof shapeRequestSchema>;

export interface OperationRecord {
  id: string;
  type: OperationType;
  status: OperationStatus;
  request: unknown;
  result: unknown | null;
  error: { code: string; message: string } | null;
  provider: string | null;
  usage: Record<string, unknown> | null;
  cancelRequested: boolean;
  contentExpiresAt: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SurveyUrlRecord {
  id: string;
  surveyId: string;
  url: string;
  source: "seed" | "sitemap" | "link";
  parentUrl: string | null;
  depth: number;
  robotsAllowed: boolean;
  createdAt: string;
}

export type CollectionStatus = OperationStatus;
export type CollectionPageStatus = "completed" | "failed";
export interface CollectionRecord extends CollectionRequest {
  id: string;
  operationId: string;
  status: CollectionStatus;
  discoveredPages: number;
  processedPages: number;
  failedPages: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CollectionPageRecord {
  id: string;
  collectionId: string;
  url: string;
  status: CollectionPageStatus;
  source: FetchResponse["data"]["source"] | null;
  content: FetchResponse["data"]["content"] | null;
  error: string | null;
  createdAt: string;
}
