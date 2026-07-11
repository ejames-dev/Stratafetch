import { AppError } from "../errors.js";
import { assertSafeHttpUrl, type AddressResolver } from "../security/url-policy.js";
import type { RetrievedDocument } from "./types.js";

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

async function readLimitedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AppError("The response is larger than the configured limit.", 413, "CONTENT_TOO_LARGE");
  }
  if (!response.body) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      await response.body.cancel();
      throw new AppError("The response is larger than the configured limit.", 413, "CONTENT_TOO_LARGE");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
export async function retrieveWithHttp(options: {
  url: string;
  timeoutMs: number;
  maxBytes: number;
  resolver?: AddressResolver;
}): Promise<RetrievedDocument> {
  const requestedUrl = options.url;
  let currentUrl = await assertSafeHttpUrl(options.url, options.resolver);

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: {
        "accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.1",
        "user-agent": "Stratafetch/0.1 (+https://github.com/ejames-dev/Stratafetch)"
      }
    });

    if (redirectStatuses.has(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new AppError("The target returned an invalid redirect.", 502, "INVALID_REDIRECT");
      if (redirectCount === 5) throw new AppError("The target returned too many redirects.", 502, "TOO_MANY_REDIRECTS");
      currentUrl = await assertSafeHttpUrl(new URL(location, currentUrl).href, options.resolver);
      continue;
    }

    if (!response.ok) {
      throw new AppError(`The target returned HTTP ${response.status}.`, 422, "UPSTREAM_HTTP_ERROR");
    }

    return {
      requestedUrl,
      resolvedUrl: response.url || currentUrl.href,
      status: response.status,
      contentType: response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream",
      mode: "http",
      body: await readLimitedBody(response, options.maxBytes)
    };
  }

  throw new AppError("The target returned too many redirects.", 502, "TOO_MANY_REDIRECTS");
}
