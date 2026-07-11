import type { FetchRequest, FetchResponse } from "@stratafetch/contracts";
import { extractContent } from "./extract.js";
import { retrieveWithBrowser } from "./browser-retriever.js";
import { retrieveWithHttp } from "./http-retriever.js";

export async function fetchDocument(request: FetchRequest, maxBytes: number): Promise<FetchResponse> {
  const startedAt = Date.now();
  const retrieved = request.mode === "browser"
    ? await retrieveWithBrowser({ ...request, maxBytes })
    : await retrieveWithHttp({ url: request.url, timeoutMs: request.timeoutMs, maxBytes });
  const content = await extractContent(retrieved, request.outputs);

  return {
    data: {
      source: {
        requestedUrl: retrieved.requestedUrl,
        resolvedUrl: retrieved.resolvedUrl,
        status: retrieved.status,
        contentType: retrieved.contentType
      },
      content,
      retrieval: {
        mode: retrieved.mode,
        fetchedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt
      }
    }
  };
}
