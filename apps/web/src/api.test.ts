import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, formatApiError, newIdempotencyKey } from "./api";

describe("api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends same-origin credentials and parses JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(api<{ ok: boolean }>("/v1/health")).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/health",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("preserves stable API error codes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "PROVIDER_NOT_CONFIGURED",
            message: "Missing provider",
          },
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(api("/v1/search")).rejects.toMatchObject({
      status: 503,
      code: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("turns provider configuration failures into actionable copy", () => {
    const message = formatApiError(
      new ApiError("Missing", 503, "PROVIDER_NOT_CONFIGURED"),
    );
    expect(message).toContain("server environment");
  });

  it("creates an RFC-4122 idempotency key without randomUUID", () => {
    const nativeCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
    });
    expect(newIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
