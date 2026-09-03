# Changelog

All notable changes to Stratafetch are documented here. The project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Sentry error tracking for the API (`SENTRY_DSN`) and dashboard
  (`VITE_SENTRY_DSN`), disabled by default and opt-in via environment
  variables.
- A Postgres-backed integration test suite (`npm run test:integration`,
  CI's `integration` job) covering `OperationRepository`'s idempotency SQL
  and `runMigrations` against a real, disposable database.
- Unit test coverage for the auth service, the shape processor, survey
  traversal logic, content extraction (HTML and PDF), and the remaining
  `http-retriever` gaps (redirect-limit exhaustion, missing `Location`
  header, body size limits, egress proxy dispatcher wiring).

### Changed

- Rewrote the robots.txt parser to fix group merging, wildcard and `$`-anchor
  matching, and previously ignored `Crawl-delay`/`Sitemap:` directives.

### Security

- Replaced the egress proxy's `NODE_USE_ENV_PROXY` reliance, which never reached
  the proxy for `http://` targets, with an explicit `undici.ProxyAgent` dispatcher
  shared by both retrieval paths. Scoped Squid's CONNECT-allowed ports to 80+443,
  ran the egress container as non-root with no capabilities and a read-only
  filesystem, and digest-pinned its base image and package versions.
- Digest-pinned the main `Dockerfile`'s base image, matching the egress and
  ingress images.
- Closed a gap where Survey's sitemap.xml fetch was the only outbound request in
  the codebase not validated by `assertSafeHttpUrl`.
- Fixed the DNS-over-HTTPS fallback (`assertSafeHttpUrl`'s resolver, used when the
  api/worker containers' primary DNS lookup fails on the internal-only network) to
  route through the same egress proxy dispatcher `http-retriever.ts` already uses.
  It previously had no route out at all, so it failed silently and every request
  against a real hostname was rejected with `DNS_RESOLUTION_FAILED`.
- Corrected `docs/security.md`'s DNS-rebinding claim: the proxied path is
  protected by Squid resolving and connecting to the target itself, not by
  application-layer address pinning, which was never implemented.

### Fixed

- Fixed `retrieveWithHttp`'s response-size limit crashing with an unhandled
  `ERR_INVALID_STATE` instead of returning `CONTENT_TOO_LARGE` whenever a
  streamed response (any response without an accurate `Content-Length`, e.g.
  chunked transfer-encoding) exceeded the configured byte limit.

## [1.0.0-alpha.2] - 2026-08-24

### Added

- The authenticated `/v1` API for Fetch, Survey, Collection, Search, and Shape.
- Durable operations, scoped and revocable API keys, idempotent job submission,
  cancellation, exports, and configurable content retention.
- An operator dashboard for submitting work, inspecting progress and results, and
  managing API keys.
- Brave Search and OpenAI Shape provider adapters with explicit configuration health.
- Docker Compose deployment with PostgreSQL, Redis, isolated workers, and controlled
  network egress.
- OpenAPI 3.1 documentation, security and operations guidance, signed multi-platform
  container images, SPDX SBOMs, and release checksums.

### Changed

- Collection retrieves content from a Survey or an explicit URL list. Site discovery
  belongs exclusively to Survey.

### Security

- Added robots.txt enforcement, per-host throttling, private-network and metadata
  blocking, credential-safe logging, scoped bearer authentication, and secure
  dashboard sessions.
- Rebuilt the ingress image on a current `nginx:alpine` base to clear fixed
  CRITICAL/HIGH CVEs in stale Alpine packages carried by the abandoned `1.27-alpine`
  tag.

[Unreleased]: https://github.com/ejames-dev/Stratafetch/compare/v1.0.0-alpha.2...main
[1.0.0-alpha.2]: https://github.com/ejames-dev/Stratafetch/commits/v1.0.0-alpha.2
