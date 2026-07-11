import type { CollectionRequest, FetchRequest, FetchResponse } from "@stratafetch/contracts";
import type { CollectionRepository } from "./repository.js";

export type CollectionFetcher = (request: FetchRequest, maxBytes: number) => Promise<FetchResponse>;

function normalizeSameOriginLink(link: string, origin: string): string | null {
  try {
    const url = new URL(link);
    if (url.origin !== origin || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function selectRequestedContent(
  content: FetchResponse["data"]["content"],
  outputs: CollectionRequest["outputs"]
): FetchResponse["data"]["content"] {
  return {
    ...(outputs.includes("markdown") && content.markdown !== undefined ? { markdown: content.markdown } : {}),
    ...(outputs.includes("text") && content.text !== undefined ? { text: content.text } : {}),
    ...(outputs.includes("html") && content.html !== undefined ? { html: content.html } : {}),
    ...(outputs.includes("links") && content.links !== undefined ? { links: content.links } : {})
  };
}

export async function processCollection(options: {
  collectionId: string;
  repository: CollectionRepository;
  fetcher: CollectionFetcher;
  maxBytes: number;
  delayMs: number;
}): Promise<void> {
  const collection = await options.repository.get(options.collectionId);
  if (!collection) throw new Error(`Collection ${options.collectionId} does not exist.`);

  await options.repository.markRunning(collection.id);
  const origin = new URL(collection.startUrl).origin;
  const pending = [collection.startUrl];
  const seen = new Set(pending);
  let processed = 0;
  let failed = 0;

  try {
    while (pending.length > 0 && processed < collection.maxPages) {
      const url = pending.shift()!;
      try {
        const internalOutputs = [...new Set([...collection.outputs, "links"])] as CollectionRequest["outputs"];
        const response = await options.fetcher({
          url,
          mode: collection.mode,
          outputs: internalOutputs,
          timeoutMs: collection.timeoutMs,
          waitAfterLoadMs: collection.waitAfterLoadMs
        }, options.maxBytes);
        const discoveredLinks = response.data.content.links ?? [];

        await options.repository.savePage({
          collectionId: collection.id,
          url,
          status: "completed",
          source: response.data.source,
          content: selectRequestedContent(response.data.content, collection.outputs),
          error: null
        });

        for (const link of discoveredLinks) {
          if (seen.size >= collection.maxPages) break;
          const normalized = normalizeSameOriginLink(link, origin);
          if (!normalized || seen.has(normalized)) continue;
          seen.add(normalized);
          pending.push(normalized);
        }
      } catch (error) {
        failed += 1;
        await options.repository.savePage({
          collectionId: collection.id,
          url,
          status: "failed",
          source: null,
          content: null,
          error: error instanceof Error ? error.message : "Unknown collection page error"
        });
      }

      processed += 1;
      await options.repository.setProgress(collection.id, seen.size, processed, failed);
      if (pending.length > 0 && options.delayMs > 0) await sleep(options.delayMs);
    }

    if (processed > 0 && failed === processed) {
      throw new Error("Every page in the collection failed.");
    }
    await options.repository.markCompleted(collection.id);
  } catch (error) {
    await options.repository.markFailed(
      collection.id,
      error instanceof Error ? error.message : "Unknown collection error"
    );
    throw error;
  }
}
