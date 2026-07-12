import type { SearchRequest, SearchResult } from "@stratafetch/contracts";
import { AppError } from "../errors.js";

interface BraveResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      age?: string;
    }>;
  };
}
export class BraveSearchProvider {
  constructor(private readonly apiKey?: string) {}
  get configured() {
    return Boolean(this.apiKey);
  }
  async search(request: SearchRequest): Promise<SearchResult[]> {
    if (!this.apiKey)
      throw new AppError(
        "Brave Search is not configured.",
        503,
        "PROVIDER_NOT_CONFIGURED",
      );
    const query = new URLSearchParams({
      q: request.query,
      count: String(request.limit),
      ...(request.country ? { country: request.country } : {}),
      ...(request.language ? { search_lang: request.language } : {}),
      ...(request.freshness ? { freshness: request.freshness } : {}),
    });
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${query}`,
      {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.apiKey,
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      throw new AppError(
        `Brave Search returned HTTP ${response.status}.`,
        502,
        "PROVIDER_ERROR",
      );
    const payload = (await response.json()) as BraveResponse;
    return (payload.web?.results ?? [])
      .slice(0, request.limit)
      .flatMap((item, index) =>
        item.url && item.title
          ? [
              {
                rank: index + 1,
                title: item.title,
                url: item.url,
                description: item.description ?? "",
                ...(item.age ? { publishedAt: item.age } : {}),
                provider: "brave" as const,
              },
            ]
          : [],
      );
  }
}
