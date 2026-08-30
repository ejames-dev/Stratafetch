import { ProxyAgent, type Dispatcher } from "undici";
import { AppError } from "../errors.js";
import {
  assertSafeHttpUrl,
  type AddressResolver,
} from "../security/url-policy.js";
import type { RetrievedDocument } from "./types.js";

// Node's global fetch only honors HTTP_PROXY/HTTPS_PROXY when opted in via
// NODE_USE_ENV_PROXY, and undici's EnvHttpProxyAgent (still experimental as
// of undici 6.28 / Node 22) never actually reaches the proxy for plain
// http:// targets — the request just hangs until the caller's own timeout
// fires. Confirmed empirically against the pinned node:22-bookworm-slim
// runtime: https:// tunnels via CONNECT correctly, http:// does not.
// Building the dispatcher explicitly (the same "configure it directly,
// don't rely on ambient env vars" approach browser-retriever.ts already
// uses for Playwright) works for both schemes.
const dispatcherCache = new Map<string, Dispatcher>();

function dispatcherFor(proxyUrl: string | undefined): Dispatcher | undefined {
  if (!proxyUrl) return undefined;
  const cached = dispatcherCache.get(proxyUrl);
  if (cached) return cached;
  const dispatcher = new ProxyAgent(proxyUrl);
  dispatcherCache.set(proxyUrl, dispatcher);
  return dispatcher;
}

// Node's global fetch() accepts a `dispatcher` option at runtime (it's
// undici underneath), but the ambient RequestInit type doesn't declare it.
// This is a known typing gap, not a real mismatch.
type FetchInitWithDispatcher = RequestInit & { dispatcher?: Dispatcher };

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

async function readLimitedBody(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AppError(
      "The response is larger than the configured limit.",
      413,
      "CONTENT_TOO_LARGE",
    );
  }
  if (!response.body) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      await response.body.cancel();
      throw new AppError(
        "The response is larger than the configured limit.",
        413,
        "CONTENT_TOO_LARGE",
      );
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
  proxyUrl?: string;
}): Promise<RetrievedDocument> {
  const requestedUrl = options.url;
  let currentUrl = await assertSafeHttpUrl(options.url, options.resolver);
  const dispatcher = dispatcherFor(options.proxyUrl);

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const init: FetchInitWithDispatcher = {
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
      ...(dispatcher ? { dispatcher } : {}),
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.1",
        "user-agent":
          "Stratafetch/0.1 (+https://github.com/ejames-dev/Stratafetch)",
      },
    };
    const response = await fetch(currentUrl, init);

    if (redirectStatuses.has(response.status)) {
      const location = response.headers.get("location");
      if (!location)
        throw new AppError(
          "The target returned an invalid redirect.",
          502,
          "INVALID_REDIRECT",
        );
      if (redirectCount === 5)
        throw new AppError(
          "The target returned too many redirects.",
          502,
          "TOO_MANY_REDIRECTS",
        );
      currentUrl = await assertSafeHttpUrl(
        new URL(location, currentUrl).href,
        options.resolver,
      );
      continue;
    }

    if (!response.ok) {
      throw new AppError(
        `The target returned HTTP ${response.status}.`,
        422,
        "UPSTREAM_HTTP_ERROR",
      );
    }

    return {
      requestedUrl,
      resolvedUrl: response.url || currentUrl.href,
      status: response.status,
      contentType:
        response.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase() || "application/octet-stream",
      mode: "http",
      body: await readLimitedBody(response, options.maxBytes),
    };
  }

  throw new AppError(
    "The target returned too many redirects.",
    502,
    "TOO_MANY_REDIRECTS",
  );
}
