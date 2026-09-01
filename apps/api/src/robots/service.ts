import { AppError } from "../errors.js";
import { assertSafeHttpUrl } from "../security/url-policy.js";

const PRODUCT_TOKEN = "stratafetch";

interface RobotsRule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelay?: number;
}

export interface RobotsRules {
  isAllowed(path: string): boolean;
  crawlDelay?: number | undefined;
  sitemaps: string[];
}

interface CacheEntry {
  expires: number;
  robots: RobotsRules;
}

function compilePattern(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split("*")
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`);
}

function parseGroups(body: string): {
  groups: RobotsGroup[];
  sitemaps: string[];
} {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgentLine = false;

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const split = line.indexOf(":");
    if (split < 0) continue;
    const key = line.slice(0, split).trim().toLowerCase();
    const value = line.slice(split + 1).trim();
    if (!value) continue;

    if (key === "user-agent") {
      if (!current || !lastWasAgentLine) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgentLine = true;
      continue;
    }

    lastWasAgentLine = false;
    if (key === "sitemap") {
      sitemaps.push(value);
      continue;
    }
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      current.rules.push({
        allow: key === "allow",
        pattern: value,
        regex: compilePattern(value),
      });
    } else if (key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0)
        current.crawlDelay = seconds;
    }
  }
  return { groups, sitemaps };
}

function agentMatchLength(agent: string, token: string): number {
  return token !== "*" && agent.startsWith(token) ? token.length : -1;
}

function selectGroups(groups: RobotsGroup[], agent: string): RobotsGroup[] {
  const lowerAgent = agent.toLowerCase();
  let bestSpecific = -1;
  for (const group of groups) {
    for (const token of group.agents) {
      bestSpecific = Math.max(
        bestSpecific,
        agentMatchLength(lowerAgent, token),
      );
    }
  }
  if (bestSpecific >= 0) {
    return groups.filter((group) =>
      group.agents.some(
        (token) => agentMatchLength(lowerAgent, token) === bestSpecific,
      ),
    );
  }
  return groups.filter((group) => group.agents.includes("*"));
}

function isPathAllowed(path: string, rules: RobotsRule[]): boolean {
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!rule.regex.test(path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best?.allow ?? true;
}

export function parseRobotsTxt(body: string, userAgent: string): RobotsRules {
  const { groups, sitemaps } = parseGroups(body);
  const selected = selectGroups(groups, userAgent);
  const rules = selected.flatMap((group) => group.rules);
  const crawlDelay = selected.find(
    (group) => group.crawlDelay !== undefined,
  )?.crawlDelay;
  return {
    isAllowed: (path) => isPathAllowed(path, rules),
    crawlDelay,
    sitemaps,
  };
}

export class RobotsService {
  private readonly cache = new Map<string, CacheEntry>();
  constructor(
    private readonly allowOverride = false,
    private readonly ttlMs = 60 * 60 * 1_000,
  ) {}
  async assertAllowed(urlValue: string, policy: "respect" | "ignore") {
    if (policy === "ignore") {
      if (!this.allowOverride)
        throw new AppError(
          "robots.txt override is disabled by the operator.",
          403,
          "ROBOTS_OVERRIDE_DISABLED",
        );
      return false;
    }
    const url = await assertSafeHttpUrl(urlValue);
    const origin = url.origin;
    let entry = this.cache.get(origin);
    if (!entry || entry.expires < Date.now()) {
      const robotsUrl = new URL("/robots.txt", origin);
      await assertSafeHttpUrl(robotsUrl.href);
      try {
        const response = await fetch(robotsUrl, {
          signal: AbortSignal.timeout(10_000),
          headers: { "user-agent": "Stratafetch/1.0" },
        });
        entry = {
          expires: Date.now() + this.ttlMs,
          robots: parseRobotsTxt(
            response.ok ? await response.text() : "",
            PRODUCT_TOKEN,
          ),
        };
      } catch {
        entry = {
          expires: Date.now() + Math.min(this.ttlMs, 60_000),
          robots: parseRobotsTxt("", PRODUCT_TOKEN),
        };
      }
      this.cache.set(origin, entry);
    }
    if (!entry.robots.isAllowed(`${url.pathname}${url.search}`))
      throw new AppError(
        "robots.txt does not allow this URL.",
        403,
        "ROBOTS_DENIED",
      );
    return true;
  }
}
