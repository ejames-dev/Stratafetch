import { describe, expect, it, vi } from "vitest";
import type { CollectionRecord, FetchRequest, FetchResponse } from "@stratafetch/contracts";
import { processCollection } from "./processor.js";
import type { CollectionRepository } from "./repository.js";

function collection(overrides: Partial<CollectionRecord> = {}): CollectionRecord {
  return {
    id: "82d0c44b-3ae9-4ee9-bf02-b783379e7294",
    status: "queued",
    startUrl: "https://site.test/",
    maxPages: 3,
    mode: "http",
    outputs: ["text"],
    timeoutMs: 30_000,
    waitAfterLoadMs: 0,
    discoveredPages: 1,
    processedPages: 0,
    failedPages: 0,
    error: null,
    createdAt: new Date(0).toISOString(),
    startedAt: null,
    completedAt: null,
    ...overrides
  };
}

function repository(record: CollectionRecord) {
  const pages: Parameters<CollectionRepository["savePage"]>[0][] = [];
  const repo: CollectionRepository = {
    create: vi.fn(),
    get: vi.fn(async () => record),
    listPages: vi.fn(async () => []),
    markRunning: vi.fn(async () => undefined),
    markCompleted: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    setProgress: vi.fn(async () => undefined),
    savePage: vi.fn(async (page) => { pages.push(page); })
  };
  return { repo, pages };
}

function response(url: string, links: string[]): FetchResponse {
  return {
    data: {
      source: { requestedUrl: url, resolvedUrl: url, status: 200, contentType: "text/html" },
      content: { text: `Content for ${url}`, links },
      retrieval: { mode: "http", fetchedAt: new Date(0).toISOString(), durationMs: 1 }
    }
  };
}

describe("processCollection", () => {
  it("discovers same-origin pages up to the configured limit", async () => {
    const { repo, pages } = repository(collection());
    const fetcher = vi.fn(async (request: FetchRequest) => response(request.url, request.url.endsWith("/")
      ? ["https://site.test/a", "https://other.test/ignored", "https://site.test/b#section"]
      : []));

    await processCollection({
      collectionId: "82d0c44b-3ae9-4ee9-bf02-b783379e7294",
      repository: repo,
      fetcher,
      maxBytes: 1024,
      delayMs: 0
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(pages.map(({ url }) => url)).toEqual([
      "https://site.test/",
      "https://site.test/a",
      "https://site.test/b"
    ]);
    expect(repo.setProgress).toHaveBeenLastCalledWith(
      "82d0c44b-3ae9-4ee9-bf02-b783379e7294",
      3,
      3,
      0
    );
    expect(repo.markCompleted).toHaveBeenCalledOnce();
  });

  it("records a failed page and continues the collection", async () => {
    const { repo, pages } = repository(collection({ maxPages: 2 }));
    const fetcher = vi.fn(async (request: FetchRequest) => {
      if (request.url.endsWith("/broken")) throw new Error("upstream failed");
      return response(request.url, ["https://site.test/broken"]);
    });

    await processCollection({
      collectionId: "82d0c44b-3ae9-4ee9-bf02-b783379e7294",
      repository: repo,
      fetcher,
      maxBytes: 1024,
      delayMs: 0
    });

    expect(pages[1]).toMatchObject({ status: "failed", error: "upstream failed" });
    expect(repo.setProgress).toHaveBeenLastCalledWith(
      "82d0c44b-3ae9-4ee9-bf02-b783379e7294",
      2,
      2,
      1
    );
    expect(repo.markCompleted).toHaveBeenCalledOnce();
  });

  it("fails the job when every page fails so BullMQ can retry it", async () => {
    const { repo } = repository(collection({ maxPages: 1 }));

    await expect(processCollection({
      collectionId: "82d0c44b-3ae9-4ee9-bf02-b783379e7294",
      repository: repo,
      fetcher: async () => { throw new Error("temporary failure"); },
      maxBytes: 1024,
      delayMs: 0
    })).rejects.toThrow("Every page in the collection failed.");

    expect(repo.markFailed).toHaveBeenCalledWith(
      "82d0c44b-3ae9-4ee9-bf02-b783379e7294",
      "Every page in the collection failed."
    );
    expect(repo.markCompleted).not.toHaveBeenCalled();
  });
});
