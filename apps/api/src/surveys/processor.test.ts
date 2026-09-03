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
