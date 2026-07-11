import { describe, expect, it } from "vitest";
import { collectionRequestSchema, fetchRequestSchema } from "./index.js";

describe("fetchRequestSchema", () => {
  it("applies safe defaults", () => {
    const request = fetchRequestSchema.parse({ url: "https://example.com" });

    expect(request.mode).toBe("http");
    expect(request.outputs).toEqual(["markdown", "text", "links"]);
    expect(request.timeoutMs).toBe(30_000);
  });

  it("rejects unsupported output types", () => {
    expect(() => fetchRequestSchema.parse({
      url: "https://example.com",
      outputs: ["screenshot"]
    })).toThrow();
  });
});

describe("collectionRequestSchema", () => {
  it("applies bounded collection defaults", () => {
    const request = collectionRequestSchema.parse({ startUrl: "https://example.com" });

    expect(request.maxPages).toBe(10);
    expect(request.mode).toBe("http");
    expect(request.outputs).toEqual(["markdown", "text"]);
  });

  it("rejects collection sizes above the initial safety limit", () => {
    expect(() => collectionRequestSchema.parse({
      startUrl: "https://example.com",
      maxPages: 101
    })).toThrow();
  });
});
