import { describe, expect, it } from "vitest";
import { extractContent } from "./extract.js";
import type { RetrievedDocument } from "./types.js";

function html(
  body: string,
  overrides: Partial<RetrievedDocument> = {},
): RetrievedDocument {
  return {
    requestedUrl: "https://example.com/",
    resolvedUrl: "https://example.com/",
    status: 200,
    mode: "http",
    contentType: "text/html",
    body: Buffer.from(body, "utf8"),
    ...overrides,
  };
}

// A hand-built, minimal-but-valid single-page PDF (no external fixture file):
// one Helvetica text run inside a fixed-size page, referenced by a plain
// (non-cross-reference-stream) xref table.
function minimalPdf(text: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 200 200] /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 24 Tf 10 100 Td (${text}) Tj ET`;
  const objStrings = [
    ...objects.map((body, i) => `${i + 1} 0 obj\n${body}\nendobj\n`),
    `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objStrings) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objStrings.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objStrings.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objStrings.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

describe("extractContent", () => {
  describe("HTML", () => {
    it("prefers <main> content over the rest of the body", async () => {
      const result = await extractContent(
        html(
          "<body><nav>Nav</nav><main>Main content</main><footer>Footer</footer></body>",
        ),
        ["text"],
      );
      expect(result.text).toBe("Main content");
    });

    it("falls back to <article> when there is no <main>", async () => {
      const result = await extractContent(
        html("<body><nav>Nav</nav><article>Article content</article></body>"),
        ["text"],
      );
      expect(result.text).toBe("Article content");
    });

    it("falls back to the full body when there is no <main> or <article>", async () => {
      const result = await extractContent(
        html("<body><p>Just a paragraph</p></body>"),
        ["text"],
      );
      expect(result.text).toBe("Just a paragraph");
    });

    it("strips script, style, noscript, and template elements", async () => {
      const result = await extractContent(
        html(
          "<body><script>evil()</script><style>.x{}</style>Visible text</body>",
        ),
        ["text"],
      );
      expect(result.text).toBe("Visible text");
    });

    it("resolves relative links against the resolved URL and dedupes them", async () => {
      const result = await extractContent(
        html(
          '<body><a href="/a">A</a><a href="/a">A again</a><a href="https://other.example/b">B</a></body>',
          { resolvedUrl: "https://example.com/page/" },
        ),
        ["links"],
      );
      expect(result.links).toEqual([
        "https://example.com/a",
        "https://other.example/b",
      ]);
    });

    it("keeps a link whose href parses as a URL even for a non-HTTP scheme", async () => {
      // extractContent only drops hrefs that fail new URL() parsing entirely —
      // it does not filter by protocol, and "javascript:..." parses fine.
      const result = await extractContent(
        html('<body><a href="javascript:void(0)">bad</a></body>', {
          resolvedUrl: "https://example.com/",
        }),
        ["links"],
      );
      expect(result.links).toEqual(["javascript:void(0)"]);
    });

    it("drops an href that fails to parse as a URL even against the base", async () => {
      const result = await extractContent(
        html('<body><a href="http://[::not-an-ip">bad</a></body>', {
          resolvedUrl: "https://example.com/",
        }),
        ["links"],
      );
      expect(result.links).toEqual([]);
    });

    it("only returns the requested outputs", async () => {
      const result = await extractContent(html("<body><p>Hi</p></body>"), [
        "text",
      ]);
      expect(result).toEqual({ text: "Hi" });
      expect(result.markdown).toBeUndefined();
      expect(result.html).toBeUndefined();
      expect(result.links).toBeUndefined();
    });

    it("converts the extracted root to markdown", async () => {
      const result = await extractContent(
        html("<main><h1>Title</h1><p>Body text</p></main>"),
        ["markdown"],
      );
      expect(result.markdown).toContain("# Title");
      expect(result.markdown).toContain("Body text");
    });

    it("accepts application/xhtml+xml as HTML", async () => {
      const result = await extractContent(
        html("<body><p>xhtml</p></body>", {
          contentType: "application/xhtml+xml",
        }),
        ["text"],
      );
      expect(result.text).toBe("xhtml");
    });

    it("rejects unsupported content types", async () => {
      await expect(
        extractContent(html("irrelevant", { contentType: "image/png" }), [
          "text",
        ]),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT_TYPE" });
    });
  });

  describe("PDF", () => {
    it("extracts text from a PDF and mirrors it into markdown when requested", async () => {
      const document = html("", {
        contentType: "application/pdf",
        body: minimalPdf("Hello PDF"),
      });
      const result = await extractContent(document, ["text", "markdown"]);
      expect(result.text).toContain("Hello PDF");
      expect(result.markdown).toBe(result.text);
    });

    it("returns an empty links array for PDFs when links are requested", async () => {
      const document = html("", {
        contentType: "application/pdf",
        body: minimalPdf("Hello PDF"),
      });
      const result = await extractContent(document, ["links"]);
      expect(result.links).toEqual([]);
    });

    it("only returns the requested outputs for PDFs too", async () => {
      const document = html("", {
        contentType: "application/pdf",
        body: minimalPdf("Hello PDF"),
      });
      const result = await extractContent(document, ["text"]);
      expect(result.markdown).toBeUndefined();
      expect(result.links).toBeUndefined();
    });
  });
});
