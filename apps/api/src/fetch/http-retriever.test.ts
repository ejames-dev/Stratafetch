import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressResolver } from "../security/url-policy.js";
import { retrieveWithHttp } from "./http-retriever.js";

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
});
