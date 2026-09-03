import { describe, expect, it, vi } from "vitest";
import type { ShapeRequest } from "@stratafetch/contracts";
import { processShape } from "./processor.js";

function setup() {
  const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
  const operations = {
    markRunning: vi.fn(async () => {}),
    get: vi.fn(async () => null),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };
  const provider = {
    shape: vi.fn(async () => ({
      value: { answer: 42 },
      usage: { totalTokens: 10 },
    })),
  };
  return { pool, operations, provider };
}

function run(request: ShapeRequest, deps = setup()) {
  return {
    ...deps,
    promise: processShape({
      operationId: "op-1",
      request,
      pool: deps.pool as never,
      operations: deps.operations as never,
      provider: deps.provider as never,
    }),
  };
}

describe("processShape", () => {
  it("shapes inline content directly", async () => {
    const { promise, provider, operations } = run({
      source: { type: "inline", content: "hello world" },
      schema: { type: "object" },
    });
    await promise;

    expect(provider.shape).toHaveBeenCalledWith(
      "hello world",
      { type: "object" },
      undefined,
    );
    expect(operations.complete).toHaveBeenCalledWith(
      "op-1",
      { data: { answer: 42 } },
      { totalTokens: 10 },
    );
  });

  it("shapes content from a prior fetch operation's stored result", async () => {
    const deps = setup();
    deps.operations.get = vi.fn(async (id: string) =>
      id === "fetch-op-1" ? ({ result: { text: "fetched" } } as never) : null,
    );
    const { promise, provider } = run(
      {
        source: { type: "fetch", fetchId: "fetch-op-1" },
        schema: { type: "object" },
      },
      deps,
    );
    await promise;

    expect(provider.shape).toHaveBeenCalledWith(
      JSON.stringify({ text: "fetched" }),
      { type: "object" },
      undefined,
    );
  });

  it("shapes empty content when the referenced fetch operation has no result", async () => {
    const { promise, provider } = run({
      source: { type: "fetch", fetchId: "missing-op" },
      schema: { type: "object" },
    });
    await promise;

    expect(provider.shape).toHaveBeenCalledWith(
      JSON.stringify(""),
      { type: "object" },
      undefined,
    );
  });

  it("shapes concatenated collection page content, filtered to selected page ids", async () => {
    const deps = setup();
    deps.pool.query = vi.fn(async () => ({
      rows: [{ content: { text: "a" } }, { content: { text: "b" } }],
      rowCount: 2,
    }));
    const { promise, provider, pool } = run(
      {
        source: {
          type: "collection",
          collectionId: "col-1",
          pageIds: ["page-1", "page-2"],
        },
        schema: { type: "object" },
      },
      deps,
    );
    await promise;

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("AND id=ANY($2::uuid[])"),
      ["col-1", ["page-1", "page-2"]],
    );
    expect(provider.shape).toHaveBeenCalledWith(
      `${JSON.stringify({ text: "a" })}\n${JSON.stringify({ text: "b" })}`,
      { type: "object" },
      undefined,
    );
  });

  it("queries all collection pages when no pageIds filter is given", async () => {
    const { promise, pool } = run({
      source: { type: "collection", collectionId: "col-1" },
      schema: { type: "object" },
    });
    await promise;

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ["col-1"]);
    const [sql] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(sql).not.toContain("id=ANY");
  });

  it("rejects content over the 2 MB limit and marks the operation failed", async () => {
    const { promise, operations, provider } = run({
      source: { type: "inline", content: "x".repeat(2_000_001) },
      schema: { type: "object" },
    });

    await expect(promise).rejects.toThrow(
      "Shape input exceeds the 2 MB limit.",
    );
    expect(provider.shape).not.toHaveBeenCalled();
    expect(operations.fail).toHaveBeenCalledWith(
      "op-1",
      "SHAPE_FAILED",
      "Shape input exceeds the 2 MB limit.",
    );
  });

  it("marks the operation failed when the provider throws", async () => {
    const deps = setup();
    deps.provider.shape = vi.fn(async () => {
      throw new Error("provider exploded");
    });
    const { promise, operations } = run(
      {
        source: { type: "inline", content: "hello" },
        schema: { type: "object" },
      },
      deps,
    );

    await expect(promise).rejects.toThrow("provider exploded");
    expect(operations.fail).toHaveBeenCalledWith(
      "op-1",
      "SHAPE_FAILED",
      "provider exploded",
    );
  });
});
