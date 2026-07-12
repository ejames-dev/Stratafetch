import type {
  FetchRequest,
  FetchResponse,
  SurveyRequest,
} from "@stratafetch/contracts";
import type { OperationRepository } from "../operations/repository.js";
import type { RobotsService } from "../robots/service.js";
import { SurveyRepository } from "./repository.js";
type Fetcher = (
  request: FetchRequest,
  maxBytes: number,
) => Promise<FetchResponse>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function match(url: string, patterns: string[]) {
  return patterns.some((pattern) =>
    new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`,
    ).test(url),
  );
}
function normalize(link: string, seed: URL, subdomains: boolean) {
  try {
    const url = new URL(link);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const allowed = subdomains
      ? url.hostname === seed.hostname ||
        url.hostname.endsWith(`.${seed.hostname}`)
      : url.origin === seed.origin;
    if (!allowed) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
export async function processSurvey(options: {
  surveyId: string;
  operationId: string;
  request: SurveyRequest;
  repo: SurveyRepository;
  operations: OperationRepository;
  robots: RobotsService;
  fetcher: Fetcher;
  maxBytes: number;
  delayMs: number;
}) {
  await options.operations.markRunning(options.operationId);
  const seed = new URL(options.request.startUrl);
  const pending: Array<{
    url: string;
    depth: number;
    source: "seed" | "sitemap" | "link";
    parent: string | null;
  }> = [{ url: seed.href, depth: 0, source: "seed", parent: null }];
  const seen = new Set<string>();
  try {
    try {
      const sitemapUrl = new URL("/sitemap.xml", seed.origin);
      const response = await fetch(sitemapUrl, {
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const xml = await response.text();
        for (const matchValue of xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
          const url = normalize(
            matchValue[1]!,
            seed,
            options.request.includeSubdomains,
          );
          if (url && !seen.has(url))
            pending.push({
              url,
              depth: 0,
              source: "sitemap",
              parent: sitemapUrl.href,
            });
        }
      }
    } catch {}
    while (pending.length && seen.size < options.request.maxUrls) {
      if (
        await options.operations.isCancellationRequested(options.operationId)
      ) {
        await options.operations.markCancelled(options.operationId);
        return;
      }
      const item = pending.shift()!;
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      if (
        options.request.include.length &&
        !match(item.url, options.request.include)
      )
        continue;
      if (match(item.url, options.request.exclude)) continue;
      let allowed = true;
      try {
        allowed = await options.robots.assertAllowed(
          item.url,
          options.request.robotsPolicy,
        );
      } catch {
        allowed = false;
      }
      await options.repo.saveUrl(
        options.surveyId,
        item.url,
        item.source,
        item.parent,
        item.depth,
        allowed,
      );
      if (!allowed || item.depth >= options.request.maxDepth) continue;
      try {
        const response = await options.fetcher(
          {
            url: item.url,
            mode: options.request.mode,
            outputs: ["links"],
            timeoutMs: 30_000,
            waitAfterLoadMs: 0,
            robotsPolicy: options.request.robotsPolicy,
          },
          options.maxBytes,
        );
        for (const link of response.data.content.links ?? []) {
          const url = normalize(
            String(link),
            seed,
            options.request.includeSubdomains,
          );
          if (
            url &&
            !seen.has(url) &&
            pending.length + seen.size < options.request.maxUrls
          )
            pending.push({
              url,
              depth: item.depth + 1,
              source: "link",
              parent: item.url,
            });
        }
      } catch {}
      if (options.delayMs) await sleep(options.delayMs);
    }
    await options.operations.complete(options.operationId, {
      surveyId: options.surveyId,
      discoveredUrls: await options.repo.countUrls(options.surveyId),
    });
  } catch (error) {
    await options.operations.fail(
      options.operationId,
      "SURVEY_FAILED",
      error instanceof Error ? error.message : "Survey failed",
    );
    throw error;
  }
}
