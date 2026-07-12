import { chromium } from "playwright";
import { AppError } from "../errors.js";
import { assertSafeHttpUrl } from "../security/url-policy.js";
import type { RetrievedDocument } from "./types.js";

export async function retrieveWithBrowser(options: {
  url: string;
  timeoutMs: number;
  waitAfterLoadMs: number;
  maxBytes: number;
  proxyUrl?: string;
}): Promise<RetrievedDocument> {
  await assertSafeHttpUrl(options.url);
  const browser = await chromium.launch({
    headless: true,
    ...(options.proxyUrl ? { proxy: { server: options.proxyUrl } } : {}),
  });

  try {
    const context = await browser.newContext({
      userAgent: "Stratafetch/0.1 (+https://github.com/ejames-dev/Stratafetch)",
    });
    const page = await context.newPage();

    await page.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      if (requestUrl.startsWith("data:") || requestUrl.startsWith("blob:")) {
        await route.continue();
        return;
      }
      try {
        await assertSafeHttpUrl(requestUrl);
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });

    const response = await page.goto(options.url, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    if (!response)
      throw new AppError(
        "The browser did not receive a document response.",
        422,
        "EMPTY_BROWSER_RESPONSE",
      );
    if (!response.ok())
      throw new AppError(
        `The target returned HTTP ${response.status()}.`,
        422,
        "UPSTREAM_HTTP_ERROR",
      );
    if (options.waitAfterLoadMs > 0)
      await page.waitForTimeout(options.waitAfterLoadMs);

    const html = await page.content();
    const body = Buffer.from(html);
    if (body.length > options.maxBytes) {
      throw new AppError(
        "The rendered page is larger than the configured limit.",
        413,
        "CONTENT_TOO_LARGE",
      );
    }

    return {
      requestedUrl: options.url,
      resolvedUrl: page.url(),
      status: response.status(),
      contentType: "text/html",
      mode: "browser",
      body,
    };
  } finally {
    await browser.close();
  }
}
