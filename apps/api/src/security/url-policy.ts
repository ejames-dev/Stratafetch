import { lookup as nodeLookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { AppError } from "../errors.js";

export type AddressResolver = (hostname: string) => Promise<string[]>;

async function resolveOverHttps(hostname: string): Promise<string[]> {
  const responses = await Promise.all(
    ["A", "AAAA"].map(async (type) => {
      const endpoint = new URL("https://1.1.1.1/dns-query");
      endpoint.searchParams.set("name", hostname);
      endpoint.searchParams.set("type", type);
      const response = await fetch(endpoint, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return [];
      const body = (await response.json()) as {
        Answer?: Array<{ type: number; data: string }>;
      };
      return (body.Answer ?? [])
        .filter((answer) => answer.type === 1 || answer.type === 28)
        .map((answer) => answer.data);
    }),
  );
  return responses.flat();
}

const defaultResolver: AddressResolver = async (hostname) => {
  try {
    const addresses = await nodeLookup(hostname, { all: true, verbatim: true });
    return addresses.map(({ address }) => address);
  } catch (error) {
    if (!process.env.EGRESS_PROXY_URL) throw error;
    return resolveOverHttps(hostname);
  }
};

function isPublicAddress(address: string): boolean {
  let parsed = ipaddr.parse(address);
  if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
    parsed = parsed.toIPv4Address();
  }
  return parsed.range() === "unicast";
}

export async function assertSafeHttpUrl(
  input: string,
  resolver: AddressResolver = defaultResolver,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError("The supplied URL is invalid.", 400, "INVALID_URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError(
      "Only HTTP and HTTPS URLs are supported.",
      400,
      "UNSUPPORTED_PROTOCOL",
    );
  }
  if (url.username || url.password) {
    throw new AppError(
      "URLs containing credentials are not accepted.",
      400,
      "URL_CREDENTIALS_BLOCKED",
    );
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new AppError(
      "Local and private network targets are blocked.",
      400,
      "PRIVATE_TARGET_BLOCKED",
    );
  }

  let addresses: string[];
  try {
    addresses = isIP(hostname) ? [hostname] : await resolver(hostname);
  } catch {
    throw new AppError(
      "The target hostname could not be resolved.",
      422,
      "DNS_RESOLUTION_FAILED",
    );
  }

  if (addresses.length === 0) {
    throw new AppError(
      "The target hostname did not resolve to an address.",
      422,
      "DNS_RESOLUTION_FAILED",
    );
  }
  if (addresses.some((address) => !isPublicAddress(address))) {
    throw new AppError(
      "Local and private network targets are blocked.",
      400,
      "PRIVATE_TARGET_BLOCKED",
    );
  }

  return url;
}
