import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../errors.js";
import {
  assertSafeHttpUrl,
  resolveOverHttps,
  type AddressResolver,
} from "./url-policy.js";

const publicResolver: AddressResolver = async () => ["93.184.216.34"];

describe("assertSafeHttpUrl", () => {
  it("accepts public HTTP targets", async () => {
    const url = await assertSafeHttpUrl(
      "https://example.com/page",
      publicResolver,
    );
    expect(url.hostname).toBe("example.com");
  });

  it.each([
    "http://127.0.0.1/admin",
    "http://10.0.0.2/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
  ])("blocks non-public IP address %s", async (target) => {
    await expect(
      assertSafeHttpUrl(target, publicResolver),
    ).rejects.toMatchObject({
      code: "PRIVATE_TARGET_BLOCKED",
    } satisfies Partial<AppError>);
  });

  it("blocks hostnames that resolve to private addresses", async () => {
    await expect(
      assertSafeHttpUrl("https://internal.example", async () => [
        "192.168.1.10",
      ]),
    ).rejects.toMatchObject({ code: "PRIVATE_TARGET_BLOCKED" });
  });

  it("blocks non-HTTP protocols and embedded credentials", async () => {
    await expect(
      assertSafeHttpUrl("file:///etc/passwd", publicResolver),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_PROTOCOL" });
    await expect(
      assertSafeHttpUrl("https://user:pass@example.com", publicResolver),
    ).rejects.toMatchObject({ code: "URL_CREDENTIALS_BLOCKED" });
  });
});

describe("resolveOverHttps", () => {
  const originalProxyUrl = process.env.EGRESS_PROXY_URL;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalProxyUrl === undefined) delete process.env.EGRESS_PROXY_URL;
    else process.env.EGRESS_PROXY_URL = originalProxyUrl;
  });

  it("routes the DNS-over-HTTPS fallback through the egress dispatcher", async () => {
    // api/worker have no route to 1.1.1.1 on the deployed internal-only
    // network: without a dispatcher this fetch hangs/fails the same way the
    // primary node:dns lookup already did, and every real hostname 404s on
    // DNS_RESOLUTION_FAILED. Regression test for that gap.
    process.env.EGRESS_PROXY_URL = "http://egress:3128";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            Answer: [{ type: 1, data: "93.184.216.34" }],
          }),
          { status: 200 },
        ),
    );

    await resolveOverHttps("example.com");

    expect(fetchSpy).toHaveBeenCalled();
    for (const call of fetchSpy.mock.calls) {
      const init = call[1] as RequestInit & { dispatcher?: unknown };
      expect(init.dispatcher).toBeDefined();
    }
  });

  it("omits the dispatcher when no egress proxy is configured", async () => {
    delete process.env.EGRESS_PROXY_URL;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response(JSON.stringify({}), { status: 200 }),
      );

    await resolveOverHttps("example.com");

    for (const call of fetchSpy.mock.calls) {
      const init = call[1] as RequestInit & { dispatcher?: unknown };
      expect(init.dispatcher).toBeUndefined();
    }
  });
});
