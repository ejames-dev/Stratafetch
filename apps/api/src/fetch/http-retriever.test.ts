import { afterEach, describe, expect, it, vi } from "vitest";
import { ProxyAgent } from "undici";
import type { AddressResolver } from "../security/url-policy.js";
import { retrieveWithHttp } from "./http-retriever.js";

const publicResolver: AddressResolver = async () => ["93.184.216.34"];

afterEach(() => vi.restoreAllMocks());

describe("retrieveWithHttp", () => {
  it("re-validates a redirect target and blocks one that resolves privately", async () => {
    const resolver: AddressResolver = async (hostname) =>
      hostname === "internal.example" ? ["192.168.1.10"] : ["93.184.216.34"];

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://internal.example/secrets" },
      }),
    );

    await expect(
      retrieveWithHttp({
        url: "https://public.example/start",
        timeoutMs: 5_000,
        maxBytes: 1_000_000,
        resolver,
      }),
    ).rejects.toMatchObject({ code: "PRIVATE_TARGET_BLOCKED" });

    // The redirect must be rejected before a second request is ever made —
    // the SSRF check runs before the follow-up fetch, not after it fails.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect to a public target", async () => {
    const resolver: AddressResolver = async () => ["93.184.216.34"];

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://public-target.example/page" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );

    const result = await retrieveWithHttp({
      url: "https://public.example/start",
      timeoutMs: 5_000,
      maxBytes: 1_000_000,
      resolver,
    });

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after too many redirects", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://public.example/next" },
      }),
    );

    await expect(
      retrieveWithHttp({
        url: "https://public.example/start",
        timeoutMs: 5_000,
        maxBytes: 1_000_000,
        resolver: publicResolver,
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });

    // redirectCount runs 0..5 inclusive before giving up: 6 requests total.
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("rejects a redirect response with no Location header", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 302 }),
    );

    await expect(
      retrieveWithHttp({
        url: "https://public.example/start",
        timeoutMs: 5_000,
        maxBytes: 1_000_000,
        resolver: publicResolver,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REDIRECT" });
  });

  it("rejects a response whose declared Content-Length exceeds the limit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("small body", {
        status: 200,
        headers: {
          "content-type": "text/html",
          "content-length": "999999999",
        },
      }),
    );

    await expect(
      retrieveWithHttp({
        url: "https://public.example/start",
        timeoutMs: 5_000,
        maxBytes: 1_000,
        resolver: publicResolver,
      }),
    ).rejects.toMatchObject({ code: "CONTENT_TOO_LARGE" });
  });

  it("rejects a response whose actual body exceeds the limit even without a Content-Length header", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(600));
        controller.enqueue(new Uint8Array(600));
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(
      retrieveWithHttp({
        url: "https://public.example/start",
        timeoutMs: 5_000,
        maxBytes: 1_000,
        resolver: publicResolver,
      }),
    ).rejects.toMatchObject({ code: "CONTENT_TOO_LARGE" });
  });

  it("accepts a body within the size limit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("small body", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const result = await retrieveWithHttp({
      url: "https://public.example/start",
      timeoutMs: 5_000,
      maxBytes: 1_000_000,
      resolver: publicResolver,
    });

    expect(result.body.toString("utf8")).toBe("small body");
  });

  describe("egress proxy dispatcher", () => {
    it("routes the request through a ProxyAgent when proxyUrl is configured", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );

      await retrieveWithHttp({
        url: "https://public.example/start",
        timeoutMs: 5_000,
        maxBytes: 1_000_000,
        resolver: publicResolver,
        proxyUrl: "http://egress-under-test:3128",
      });

      const [, init] = fetchMock.mock.calls[0]!;
      expect((init as { dispatcher?: unknown }).dispatcher).toBeInstanceOf(
        ProxyAgent,
      );
    });

    it("does not set a dispatcher when no proxyUrl is configured", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );

      await retrieveWithHttp({
        url: "https://public.example/start",
        timeoutMs: 5_000,
        maxBytes: 1_000_000,
        resolver: publicResolver,
      });

      const [, init] = fetchMock.mock.calls[0]!;
      expect(init).not.toHaveProperty("dispatcher");
    });

    it("reuses the same dispatcher instance across calls for the same proxy URL", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );

      const proxyUrl = "http://egress-reuse-test:3128";
      await retrieveWithHttp({
        url: "https://public.example/a",
        timeoutMs: 5_000,
        maxBytes: 1_000_000,
        resolver: publicResolver,
        proxyUrl,
      });
      await retrieveWithHttp({
        url: "https://public.example/b",
        timeoutMs: 5_000,
        maxBytes: 1_000_000,
        resolver: publicResolver,
        proxyUrl,
      });

      const firstDispatcher = (
        fetchMock.mock.calls[0]![1] as { dispatcher?: unknown }
      ).dispatcher;
      const secondDispatcher = (
        fetchMock.mock.calls[1]![1] as { dispatcher?: unknown }
      ).dispatcher;
      expect(firstDispatcher).toBe(secondDispatcher);
    });
  });
});
