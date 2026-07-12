import { describe, expect, it, vi } from "vitest";
import type {
  CollectionRecord,
  FetchRequest,
  FetchResponse,
} from "@stratafetch/contracts";
import { processCollection } from "./processor.js";
const record = (urls: string[]): CollectionRecord => ({
  id: "82d0c44b-3ae9-4ee9-bf02-b783379e7294",
  operationId: "6c8618fe-074d-49b5-a336-b50c455e9539",
  status: "queued",
  source: { type: "urls", urls },
  mode: "http",
  outputs: ["text"],
  timeoutMs: 30_000,
  waitAfterLoadMs: 0,
  robotsPolicy: "respect",
  discoveredPages: urls.length,
  processedPages: 0,
  failedPages: 0,
  error: null,
  createdAt: new Date(0).toISOString(),
  startedAt: null,
  completedAt: null,
});
const response = (url: string): FetchResponse => ({
  data: {
    source: {
      requestedUrl: url,
      resolvedUrl: url,
      status: 200,
      contentType: "text/html",
    },
    content: { text: `content ${url}` },
    retrieval: {
      mode: "http",
      fetchedAt: new Date(0).toISOString(),
      durationMs: 1,
    },
  },
});
function setup(urls: string[]) {
  const pages: unknown[] = [];
  const repo = {
    get: vi.fn(async () => record(urls)),
    updateStatus: vi.fn(async () => {}),
    savePage: vi.fn(async (page) => {
      pages.push(page);
    }),
    setProgress: vi.fn(async () => {}),
  };
  const operations = {
    markRunning: vi.fn(async () => {}),
    isCancellationRequested: vi.fn(async () => false),
    get: vi.fn(async () => ({ contentExpiresAt: null })),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };
  return { repo, operations, pages };
}
describe("strict Collection", () => {
  it("retrieves only explicit URLs and does not discover links", async () => {
    const state = setup(["https://site.test/a", "https://site.test/b"]);
    const fetcher = vi.fn(async (request: FetchRequest) =>
      response(request.url),
    );
    await processCollection({
      collectionId: "id",
      repo: state.repo as never,
      surveys: { allUrls: vi.fn() } as never,
      operations: state.operations as never,
      robots: { assertAllowed: vi.fn(async () => true) } as never,
      fetcher,
      maxBytes: 1024,
      delayMs: 0,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(state.pages).toHaveLength(2);
    expect(state.operations.complete).toHaveBeenCalledOnce();
  });
  it("records partial failures and completes", async () => {
    const state = setup(["https://site.test/a", "https://site.test/b"]);
    await processCollection({
      collectionId: "id",
      repo: state.repo as never,
      surveys: {} as never,
      operations: state.operations as never,
      robots: { assertAllowed: vi.fn(async () => true) } as never,
      fetcher: async (request) => {
        if (request.url.endsWith("b")) throw new Error("blocked");
        return response(request.url);
      },
      maxBytes: 1024,
      delayMs: 0,
    });
    expect(state.repo.setProgress).toHaveBeenLastCalledWith(
      expect.any(String),
      2,
      1,
    );
    expect(state.operations.complete).toHaveBeenCalledOnce();
  });
  it("fails when every page fails", async () => {
    const state = setup(["https://site.test/a"]);
    await expect(
      processCollection({
        collectionId: "id",
        repo: state.repo as never,
        surveys: {} as never,
        operations: state.operations as never,
        robots: { assertAllowed: vi.fn(async () => true) } as never,
        fetcher: async () => {
          throw new Error("down");
        },
        maxBytes: 1024,
        delayMs: 0,
      }),
    ).rejects.toThrow("Every page");
    expect(state.operations.fail).toHaveBeenCalledOnce();
  });
});
