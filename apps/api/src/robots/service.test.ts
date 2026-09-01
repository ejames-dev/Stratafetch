import { describe, expect, it } from "vitest";
import { parseRobotsTxt } from "./service.js";

const AGENT = "Stratafetch";

describe("parseRobotsTxt", () => {
  it.each([
    {
      name: "merges consecutive user-agent lines into one group",
      body: `
        User-agent: *
        User-agent: Googlebot
        Disallow: /x
      `,
      path: "/x",
      allowed: false,
    },
    {
      name: "a merged group still leaves unrelated paths open",
      body: `
        User-agent: *
        User-agent: Googlebot
        Disallow: /x
      `,
      path: "/y",
      allowed: true,
    },
    {
      name: "a directive before any user-agent line is ignored",
      body: `
        Disallow: /secret
        User-agent: *
        Allow: /
      `,
      path: "/secret",
      allowed: true,
    },
    {
      name: "matches a mid-pattern wildcard",
      body: `
        User-agent: *
        Disallow: /private/*/edit
      `,
      path: "/private/123/edit",
      allowed: false,
    },
    {
      name: "a mid-pattern wildcard does not match a different suffix",
      body: `
        User-agent: *
        Disallow: /private/*/edit
      `,
      path: "/private/123/view",
      allowed: true,
    },
    {
      name: "an end anchor requires the pattern to end the path",
      body: `
        User-agent: *
        Disallow: /*.pdf$
      `,
      path: "/report.pdf",
      allowed: false,
    },
    {
      name: "an end anchor rejects trailing characters after it",
      body: `
        User-agent: *
        Disallow: /*.pdf$
      `,
      path: "/report.pdf?download=1",
      allowed: true,
    },
    {
      name: "without an end anchor, trailing characters still match",
      body: `
        User-agent: *
        Disallow: /report.pdf
      `,
      path: "/report.pdf?download=1",
      allowed: false,
    },
    {
      name: "the longest matching pattern wins over a shorter one",
      body: `
        User-agent: *
        Disallow: /
        Allow: /public/
      `,
      path: "/public/page",
      allowed: true,
    },
    {
      name: "the longest matching pattern still blocks paths outside it",
      body: `
        User-agent: *
        Disallow: /
        Allow: /public/
      `,
      path: "/private/page",
      allowed: false,
    },
    {
      name: "equal-length allow and disallow rules resolve to allow",
      body: `
        User-agent: *
        Disallow: /a
        Allow: /a
      `,
      path: "/a",
      allowed: true,
    },
    {
      name: "a group naming this agent specifically overrides the wildcard group",
      body: `
        User-agent: *
        Disallow: /
        User-agent: Stratafetch
        Allow: /
      `,
      path: "/anything",
      allowed: true,
    },
    {
      name: "an unrelated named group does not shadow an applicable wildcard group",
      body: `
        User-agent: Googlebot
        Allow: /
        User-agent: *
        Disallow: /blocked
      `,
      path: "/blocked",
      allowed: false,
    },
    {
      name: "no matching rule defaults to allowed",
      body: `
        User-agent: *
        Disallow: /blocked
      `,
      path: "/open",
      allowed: true,
    },
  ])("$name", ({ body, path, allowed }) => {
    expect(parseRobotsTxt(body, AGENT).isAllowed(path)).toBe(allowed);
  });

  it("parses crawl-delay from the selected group", () => {
    const body = `
      User-agent: *
      Crawl-delay: 5
    `;
    expect(parseRobotsTxt(body, AGENT).crawlDelay).toBe(5);
  });

  it("ignores a non-numeric crawl-delay value", () => {
    const body = `
      User-agent: *
      Crawl-delay: not-a-number
    `;
    expect(parseRobotsTxt(body, AGENT).crawlDelay).toBeUndefined();
  });

  it("collects sitemap directives regardless of surrounding groups", () => {
    const body = `
      Sitemap: https://example.com/sitemap-1.xml
      User-agent: *
      Disallow: /blocked
      Sitemap: https://example.com/sitemap-2.xml
    `;
    expect(parseRobotsTxt(body, AGENT).sitemaps).toEqual([
      "https://example.com/sitemap-1.xml",
      "https://example.com/sitemap-2.xml",
    ]);
  });

  it("defaults to allowed for an empty body", () => {
    expect(parseRobotsTxt("", AGENT).isAllowed("/anything")).toBe(true);
  });
});
