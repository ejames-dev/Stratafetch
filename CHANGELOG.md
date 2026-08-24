# Changelog

All notable changes to Stratafetch are documented here. The project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
