import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { assertSafeHttpUrl, type AddressResolver } from "./url-policy.js";

const publicResolver: AddressResolver = async () => ["93.184.216.34"];

describe("assertSafeHttpUrl", () => {
  it("accepts public HTTP targets", async () => {
    const url = await assertSafeHttpUrl("https://example.com/page", publicResolver);
    expect(url.hostname).toBe("example.com");
  });

  it.each([
    "http://127.0.0.1/admin",
    "http://10.0.0.2/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/"
  ])("blocks non-public IP address %s", async (target) => {
    await expect(assertSafeHttpUrl(target, publicResolver)).rejects.toMatchObject({
      code: "PRIVATE_TARGET_BLOCKED"
    } satisfies Partial<AppError>);
  });

  it("blocks hostnames that resolve to private addresses", async () => {
    await expect(assertSafeHttpUrl("https://internal.example", async () => ["192.168.1.10"]))
      .rejects.toMatchObject({ code: "PRIVATE_TARGET_BLOCKED" });
  });

  it("blocks non-HTTP protocols and embedded credentials", async () => {
    await expect(assertSafeHttpUrl("file:///etc/passwd", publicResolver))
      .rejects.toMatchObject({ code: "UNSUPPORTED_PROTOCOL" });
    await expect(assertSafeHttpUrl("https://user:pass@example.com", publicResolver))
      .rejects.toMatchObject({ code: "URL_CREDENTIALS_BLOCKED" });
  });
});
