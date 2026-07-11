import { z } from "zod";

export const fetchOutputSchema = z.enum(["markdown", "text", "html", "links"]);
export type FetchOutput = z.infer<typeof fetchOutputSchema>;

export const fetchRequestSchema = z.object({
  url: z.url(),
  mode: z.enum(["http", "browser"]).default("http"),
  outputs: z.array(fetchOutputSchema).min(1).default(["markdown", "text", "links"]),
  timeoutMs: z.number().int().min(1_000).max(60_000).default(30_000),
  waitAfterLoadMs: z.number().int().min(0).max(10_000).default(0)
});

export type FetchRequest = z.infer<typeof fetchRequestSchema>;

export interface FetchResponse {
  data: {
    source: {
      requestedUrl: string;
      resolvedUrl: string;
      status: number;
      contentType: string;
    };
    content: {
      markdown?: string;
      text?: string;
      html?: string;
      links?: string[];
    };
    retrieval: {
      mode: "http" | "browser";
      fetchedAt: string;
      durationMs: number;
    };
  };
}

export const collectionRequestSchema = z.object({
  startUrl: z.url(),
  maxPages: z.number().int().min(1).max(100).default(10),
  mode: z.enum(["http", "browser"]).default("http"),
  outputs: z.array(fetchOutputSchema).min(1).default(["markdown", "text"]),
  timeoutMs: z.number().int().min(1_000).max(60_000).default(30_000),
  waitAfterLoadMs: z.number().int().min(0).max(10_000).default(0)
});

export type CollectionRequest = z.infer<typeof collectionRequestSchema>;
export type CollectionStatus = "queued" | "running" | "completed" | "failed";
export type CollectionPageStatus = "completed" | "failed";

export interface CollectionRecord extends CollectionRequest {
  id: string;
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
