import { AppError } from "../errors.js";
import { assertSafeHttpUrl } from "../security/url-policy.js";

interface Rule {
  allow: boolean;
  path: string;
}
interface CacheEntry {
  expires: number;
  rules: Rule[];
}

function parse(body: string): Rule[] {
  const lines = body.split(/\r?\n/);
  let applies = false;
  const rules: Rule[] = [];
  for (const raw of lines) {
    const line = raw.replace(/#.*/, "").trim();
    const split = line.indexOf(":");
    if (split < 0) continue;
    const key = line.slice(0, split).trim().toLowerCase();
    const value = line.slice(split + 1).trim();
    if (key === "user-agent")
      applies = value === "*" || value.toLowerCase().includes("stratafetch");
    else if (applies && (key === "allow" || key === "disallow") && value)
      rules.push({ allow: key === "allow", path: value });
  }
  return rules;
}
function permitted(path: string, rules: Rule[]) {
  const matches = rules
    .filter((r) => path.startsWith(r.path))
    .sort((a, b) => b.path.length - a.path.length);
  return matches[0]?.allow ?? true;
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
          rules: response.ok ? parse(await response.text()) : [],
        };
      } catch {
        entry = {
          expires: Date.now() + Math.min(this.ttlMs, 60_000),
          rules: [],
        };
      }
      this.cache.set(origin, entry);
    }
    if (!permitted(`${url.pathname}${url.search}`, entry.rules))
      throw new AppError(
        "robots.txt does not allow this URL.",
        403,
        "ROBOTS_DENIED",
      );
    return true;
  }
}
