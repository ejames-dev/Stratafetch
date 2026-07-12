# Deployment Security

Stratafetch intentionally makes outbound requests to operator-supplied URLs and parses
untrusted HTML, PDF, JavaScript, robots.txt, sitemap, and provider output. Treat API
access as permission to consume network, browser, storage, and paid-provider resources.

## Required controls

- Publish only the TLS-protected API/dashboard entrypoint. Keep workers, the egress
  service, PostgreSQL, and Redis on private networks with authentication and persistent
  storage.
- Route all HTTP and browser traffic through the controlled egress path. Deny direct
  worker internet access and all access to loopback, RFC1918/private, link-local,
  multicast, IPv4-mapped IPv6, cloud metadata, and internal DNS destinations.
- Re-resolve and validate every redirect and browser subrequest. Pin the validated public
  address for the connection to reduce DNS-rebinding exposure.
- Enforce robots.txt by default and rate-limit each host. Ignoring robots requires both
  an operator setting and an explicit request; it does not override applicable law or a
  site's terms.
- Give API keys only the needed scopes. Rotate the bootstrap admin token and provider
  credentials after suspected exposure; never return provider values through health or
  dashboard endpoints.
- Use secure, HTTP-only, same-site dashboard cookies, protect state-changing session
  requests against CSRF, and accept dashboard sessions only on the configured origin.
- Bound response bytes, redirects, execution time, browser wait time, discovered URLs,
  collection pages, inline Shape content, concurrency, retries, and provider spending.
- Redact authorization headers, URL credentials, cookies, provider payloads, and scraped
  content from logs. Store only provenance needed for operations and auditing.

## Content and retention

Remote content can contain personal data, secrets, malicious instructions, or material
the operator lacks permission to retain. The default 30-day content expiry is a safety
baseline, not a complete compliance policy. Deletion must remove persisted content and
exports; backups expire according to the operator's documented schedule. Metadata is
retained until explicitly deleted.

Shape treats retrieved content as data, never trusted instructions. Schema validation
and repair attempts constrain output shape but do not prove factual accuracy. Do not use
Shape output for high-impact decisions without independent review.

## Known limitations

Stratafetch does not promise CAPTCHA bypass, stealth, access-control circumvention, or
protection against every browser-engine vulnerability. Keep container images updated,
run them without unnecessary privileges, and add host or cloud network policy outside
Docker. Search and Shape send configured input to Brave and OpenAI respectively; review
those providers' data terms before enabling them.
