import * as cheerio from "cheerio";
import { PDFParse } from "pdf-parse";
import TurndownService from "turndown";
import type { FetchOutput } from "@stratafetch/contracts";
import { AppError } from "../errors.js";
import type { RetrievedDocument } from "./types.js";

export async function extractContent(
  document: RetrievedDocument,
  outputs: FetchOutput[],
) {
  if (document.contentType === "application/pdf") {
    const parser = new PDFParse({ data: document.body });
    try {
      const result = await parser.getText();
      const text = result.text.trim();
      return {
        ...(outputs.includes("text") ? { text } : {}),
        ...(outputs.includes("markdown") ? { markdown: text } : {}),
        ...(outputs.includes("links") ? { links: [] } : {}),
      };
    } finally {
      await parser.destroy();
    }
  }

  if (
    document.contentType !== "text/html" &&
    document.contentType !== "application/xhtml+xml"
  ) {
    throw new AppError(
      `Unsupported content type: ${document.contentType}. Stratafetch currently accepts HTML and PDF.`,
      415,
      "UNSUPPORTED_CONTENT_TYPE",
    );
  }

  const html = document.body.toString("utf8");
  const $ = cheerio.load(html);
  $("script, style, noscript, template").remove();
  const root = $("main").first().length
    ? $("main").first()
    : $("article").first().length
      ? $("article").first()
      : $("body");
  const text = root.text().replace(/\s+/g, " ").trim();
  const links = [
    ...new Set(
      $("a[href]")
        .map((_, element) => {
          try {
            return new URL($(element).attr("href")!, document.resolvedUrl).href;
          } catch {
            return null;
          }
        })
        .get()
        .filter((link): link is string => Boolean(link)),
    ),
  ];
  const markdown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  })
    .turndown(root.html() || "")
    .trim();

  return {
    ...(outputs.includes("markdown") ? { markdown } : {}),
    ...(outputs.includes("text") ? { text } : {}),
    ...(outputs.includes("html") ? { html } : {}),
    ...(outputs.includes("links") ? { links } : {}),
  };
}
