import { describe, expect, it } from "vitest";
import {
  collectionRequestSchema,
  fetchRequestSchema,
  searchRequestSchema,
  shapeRequestSchema,
  surveyRequestSchema,
} from "./index.js";

describe("Stratafetch v1 contracts", () => {
  it("applies safe Fetch defaults", () => {
    expect(
      fetchRequestSchema.parse({ url: "https://example.test" }),
    ).toMatchObject({
      mode: "http",
      robotsPolicy: "respect",
      timeoutMs: 30_000,
    });
  });

  it("bounds Survey discovery", () => {
    expect(
      surveyRequestSchema.parse({ startUrl: "https://example.test" }).maxUrls,
    ).toBe(1_000);
    expect(() =>
      surveyRequestSchema.parse({
        startUrl: "https://example.test",
        maxUrls: 10_001,
      }),
    ).toThrow();
  });

  it("requires a strict Collection source", () => {
    expect(
      collectionRequestSchema.parse({
        source: { type: "urls", urls: ["https://example.test"] },
      }).source.type,
    ).toBe("urls");
    expect(() =>
      collectionRequestSchema.parse({ startUrl: "https://example.test" }),
    ).toThrow();
  });

  it("bounds Search results", () => {
    expect(
      searchRequestSchema.parse({ query: "strata", limit: 20 }).limit,
    ).toBe(20);
    expect(() =>
      searchRequestSchema.parse({ query: "strata", limit: 21 }),
    ).toThrow();
  });

  it("accepts JSON-schema Shape requests", () => {
    const value = shapeRequestSchema.parse({
      source: { type: "inline", content: "A layered page" },
      schema: { type: "object", properties: { title: { type: "string" } } },
    });
    expect(value.source.type).toBe("inline");
  });
});
