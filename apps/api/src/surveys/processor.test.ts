import { describe, expect, it, vi } from "vitest";
import type { SurveyRequest } from "@stratafetch/contracts";
import { processSurvey } from "./processor.js";

function request(overrides: Partial<SurveyRequest> = {}): SurveyRequest {
  return {
    startUrl: "https://example.com/",
    maxUrls: 10,
    maxDepth: 1,
    include: [],
    exclude: [],
    includeSubdomains: false,
    mode: "http",
    robotsPolicy: "respect",
    ...overrides,
  };
}

function setup() {
  const repo = {
    saveUrl: vi.fn(async () => {}),
    countUrls: vi.fn(async () => 0),
  };
  const operations = {
    markRunning: vi.fn(async () => {}),
    isCancellationRequested: vi.fn(async () => false),
    markCancelled: vi.fn(async () => {}),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };
  const robots = {
    assertAllowed: vi.fn(async () => true),
  };
  const fetcher = vi.fn(async () => {
    throw new Error("not reached in this test");
  });
  return { repo, operations, robots, fetcher };
}

describe("processSurvey sitemap discovery", () => {
  it("does not fetch a sitemap for a private/blocked seed origin", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));
    const { repo, operations, robots, fetcher } = setup();

    await processSurvey({
      surveyId: "9c1b7c9e-2f2b-4a3e-9b3a-2e2f2b4a3e9b",
      operationId: "1c1b7c9e-2f2b-4a3e-9b3a-2e2f2b4a3e9c",
      request: request({ startUrl: "http://127.0.0.1/", maxDepth: 0 }),
      repo: repo as never,
      operations: operations as never,
      robots: robots as never,
      fetcher,
      maxBytes: 1_000_000,
      delayMs: 0,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(operations.complete).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("fetches the sitemap for a public seed origin", async () => {
    // A literal public IP, not a hostname: assertSafeHttpUrl short-circuits DNS
    // resolution for IP literals, keeping this test deterministic and offline.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("<urlset></urlset>", { status: 200 }));
    const { repo, operations, robots, fetcher } = setup();

    await processSurvey({
      surveyId: "9c1b7c9e-2f2b-4a3e-9b3a-2e2f2b4a3e9b",
      operationId: "1c1b7c9e-2f2b-4a3e-9b3a-2e2f2b4a3e9c",
      request: request({
        startUrl: "http://93.184.216.34/",
        maxDepth: 0,
      }),
      repo: repo as never,
      operations: operations as never,
      robots: robots as never,
      fetcher,
      maxBytes: 1_000_000,
      delayMs: 0,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      new URL("http://93.184.216.34/sitemap.xml"),
      expect.anything(),
    );
    fetchSpy.mockRestore();
  });
});

describe("processSurvey traversal", () => {
  function fetchResponse(links: string[] = []) {
    return {
      data: {
        source: {
          requestedUrl: "https://example.com/",
          resolvedUrl: "https://example.com/",
          status: 200,
          contentType: "text/html",
        },
        content: { links },
        retrieval: {
          mode: "http" as const,
          fetchedAt: new Date(0).toISOString(),
          durationMs: 1,
        },
      },
    };
  }

  async function runWithNoSitemap<T>(fn: () => Promise<T>): Promise<T> {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 404 }));
    try {
      return await fn();
    } finally {
      fetchSpy.mockRestore();
    }
  }

  it("fetches the seed but not links discovered past maxDepth", async () => {
    const { repo, operations, robots, fetcher } = setup();
    fetcher.mockResolvedValue(
      fetchResponse(["https://example.com/child"]) as never,
    );

    await runWithNoSitemap(() =>
      processSurvey({
        surveyId: "s1",
        operationId: "o1",
        request: request({ maxDepth: 1 }),
        repo: repo as never,
        operations: operations as never,
        robots: robots as never,
        fetcher,
        maxBytes: 1_000_000,
        delayMs: 0,
      }),
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/" }),
      1_000_000,
    );
    // The depth-1 child is still recorded, just never fetched.
    expect(repo.saveUrl).toHaveBeenCalledWith(
      "s1",
      "https://example.com/child",
      "link",
      "https://example.com/",
      1,
      true,
    );
  });

  it("drops URLs that don't match an include pattern before saving them", async () => {
    const { repo, operations, robots, fetcher } = setup();

    await runWithNoSitemap(() =>
      processSurvey({
        surveyId: "s1",
        operationId: "o1",
        request: request({ include: ["https://example.com/allowed*"] }),
        repo: repo as never,
        operations: operations as never,
        robots: robots as never,
        fetcher,
        maxBytes: 1_000_000,
        delayMs: 0,
      }),
    );

    expect(repo.saveUrl).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("drops URLs that match an exclude pattern before saving them", async () => {
    const { repo, operations, robots, fetcher } = setup();

    await runWithNoSitemap(() =>
      processSurvey({
        surveyId: "s1",
        operationId: "o1",
        request: request({ exclude: ["https://example.com/*"] }),
        repo: repo as never,
        operations: operations as never,
        robots: robots as never,
        fetcher,
        maxBytes: 1_000_000,
        delayMs: 0,
      }),
    );

    expect(repo.saveUrl).not.toHaveBeenCalled();
  });

  it("does not enqueue a subdomain link when includeSubdomains is false", async () => {
    const { repo, operations, robots, fetcher } = setup();
    fetcher.mockResolvedValue(
      fetchResponse(["https://sub.example.com/child"]) as never,
    );

    await runWithNoSitemap(() =>
      processSurvey({
        surveyId: "s1",
        operationId: "o1",
        request: request({ maxDepth: 2, includeSubdomains: false }),
        repo: repo as never,
        operations: operations as never,
        robots: robots as never,
        fetcher,
        maxBytes: 1_000_000,
        delayMs: 0,
      }),
    );

    expect(repo.saveUrl).toHaveBeenCalledTimes(1);
    expect(repo.saveUrl).toHaveBeenCalledWith(
      "s1",
      "https://example.com/",
      "seed",
      null,
      0,
      true,
    );
  });

  it("enqueues a subdomain link when includeSubdomains is true", async () => {
    const { repo, operations, robots, fetcher } = setup();
    fetcher.mockResolvedValue(
      fetchResponse(["https://sub.example.com/child"]) as never,
    );

    await runWithNoSitemap(() =>
      processSurvey({
        surveyId: "s1",
        operationId: "o1",
        request: request({ maxDepth: 2, includeSubdomains: true }),
        repo: repo as never,
        operations: operations as never,
        robots: robots as never,
        fetcher,
        maxBytes: 1_000_000,
        delayMs: 0,
      }),
    );

    expect(repo.saveUrl).toHaveBeenCalledWith(
      "s1",
      "https://sub.example.com/child",
      "link",
      "https://example.com/",
      1,
      true,
    );
  });

  it("records a robots-disallowed URL without fetching it, and keeps going", async () => {
    const { repo, operations, robots, fetcher } = setup();
    robots.assertAllowed.mockResolvedValue(false);

    await runWithNoSitemap(() =>
      processSurvey({
        surveyId: "s1",
        operationId: "o1",
        request: request(),
        repo: repo as never,
        operations: operations as never,
        robots: robots as never,
        fetcher,
        maxBytes: 1_000_000,
        delayMs: 0,
      }),
    );

    expect(repo.saveUrl).toHaveBeenCalledWith(
      "s1",
      "https://example.com/",
      "seed",
      null,
      0,
      false,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(operations.complete).toHaveBeenCalled();
  });

  it("treats a robots check that throws as disallowed rather than failing the survey", async () => {
    const { repo, operations, robots, fetcher } = setup();
    robots.assertAllowed.mockRejectedValue(new Error("robots.txt timeout"));

    await runWithNoSitemap(() =>
      processSurvey({
        surveyId: "s1",
        operationId: "o1",
        request: request(),
        repo: repo as never,
        operations: operations as never,
        robots: robots as never,
        fetcher,
        maxBytes: 1_000_000,
        delayMs: 0,
      }),
    );

    expect(repo.saveUrl).toHaveBeenCalledWith(
      "s1",
      "https://example.com/",
      "seed",
      null,
      0,
      false,
    );
    expect(operations.complete).toHaveBeenCalled();
  });

  it("stops and marks the operation cancelled when cancellation is requested mid-crawl", async () => {
    const { repo, operations, robots, fetcher } = setup();
    operations.isCancellationRequested.mockResolvedValue(true);

    await runWithNoSitemap(() =>
      processSurvey({
        surveyId: "s1",
        operationId: "o1",
        request: request(),
        repo: repo as never,
        operations: operations as never,
        robots: robots as never,
        fetcher,
        maxBytes: 1_000_000,
        delayMs: 0,
      }),
    );

    expect(operations.markCancelled).toHaveBeenCalledWith("o1");
    expect(operations.complete).not.toHaveBeenCalled();
    expect(repo.saveUrl).not.toHaveBeenCalled();
  });

  it("does not let a fetcher failure abort the crawl of remaining URLs", async () => {
    const { repo, operations, robots, fetcher } = setup();
    fetcher.mockRejectedValue(new Error("network error"));

    await runWithNoSitemap(() =>
      processSurvey({
        surveyId: "s1",
        operationId: "o1",
        request: request({ maxDepth: 1 }),
        repo: repo as never,
        operations: operations as never,
        robots: robots as never,
        fetcher,
        maxBytes: 1_000_000,
        delayMs: 0,
      }),
    );

    expect(operations.complete).toHaveBeenCalled();
    expect(operations.fail).not.toHaveBeenCalled();
  });

  it("fails the operation when an unexpected error occurs outside the per-item guards", async () => {
    const { repo, operations, robots, fetcher } = setup();
    repo.saveUrl.mockRejectedValue(new Error("database exploded"));

    await expect(
      runWithNoSitemap(() =>
        processSurvey({
          surveyId: "s1",
          operationId: "o1",
          request: request(),
          repo: repo as never,
          operations: operations as never,
          robots: robots as never,
          fetcher,
          maxBytes: 1_000_000,
          delayMs: 0,
        }),
      ),
    ).rejects.toThrow("database exploded");

    expect(operations.fail).toHaveBeenCalledWith(
      "o1",
      "SURVEY_FAILED",
      "database exploded",
    );
  });
});
