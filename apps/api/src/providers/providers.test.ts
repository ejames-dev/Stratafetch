import { afterEach, describe, expect, it, vi } from "vitest";
import { BraveSearchProvider } from "./brave.js";
import { OpenAIShapeProvider } from "./openai.js";

afterEach(() => vi.restoreAllMocks());

describe("BraveSearchProvider", () => {
  it("maps ranked URL metadata without fetching result pages", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "First",
                url: "https://example.org/one",
                description: "One",
              },
              {
                title: "Second",
                url: "https://example.org/two",
                description: "Two",
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const results = await new BraveSearchProvider("test-key").search({
      query: "stratafetch",
      limit: 2,
    });

    expect(results).toMatchObject([
      { rank: 1, provider: "brave", url: "https://example.org/one" },
      { rank: 2, provider: "brave", url: "https://example.org/two" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the stable error when unconfigured", async () => {
    await expect(
      new BraveSearchProvider().search({ query: "test", limit: 1 }),
    ).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
      statusCode: 503,
    });
  });
});

describe("OpenAIShapeProvider", () => {
  const schema = {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
    additionalProperties: false,
  };

  it("uses Responses structured output and returns provider usage", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            { content: [{ type: "output_text", text: '{"title":"Strata"}' }] },
          ],
          usage: { input_tokens: 12, output_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await new OpenAIShapeProvider(
      "test-key",
      "test-model",
    ).shape("content", schema);

    expect(result).toEqual({
      value: { title: "Strata" },
      usage: { input_tokens: 12, output_tokens: 4 },
    });
    const request = fetchMock.mock.calls[0]![1]!;
    const payload = JSON.parse(String(request.body));
    expect(payload.text.format).toMatchObject({
      type: "json_schema",
      strict: true,
      schema,
    });
  });

  it("repairs invalid output up to the configured retry bound", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [{ content: [{ type: "output_text", text: "{}" }] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [
              { content: [{ type: "output_text", text: '{"title":"Fixed"}' }] },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    await expect(
      new OpenAIShapeProvider("test-key", "test-model").shape(
        "content",
        schema,
      ),
    ).resolves.toMatchObject({ value: { title: "Fixed" } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
