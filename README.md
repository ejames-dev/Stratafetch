# Stratafetch

Self-hosted web data infrastructure for turning HTML pages and PDFs into useful, structured information.

> **Early development:** Stratafetch is currently in the planning and initial implementation stage. Its APIs and workflows are not yet stable.

## Vision

Stratafetch is an original web data platform built around a simple idea: retrieving a page is only the beginning. Useful web data also needs discovery, collection, transformation, and clear provenance.

The project is designed as its own product, with an original API, interface, terminology, and architecture.

## Planned capabilities

- **Fetch** — retrieve and transform a single HTML page or PDF.
- **Survey** — discover URLs and understand a site's structure.
- **Collection** — gather content from multiple pages as a durable background job.
- **Search** — find relevant pages through pluggable search providers.
- **Shape** — transform collected content into schema-validated JSON.

## Project principles

- Self-hosted by default.
- A clear REST API and practical web dashboard.
- Provider interfaces for search, AI extraction, and proxies.
- Respectful crawling with robots.txt support and per-host rate controls.
- Standard HTTP and JavaScript-rendered page support without CAPTCHA-bypass claims.
- Secure handling of URLs, credentials, stored content, and network access.

## Initial scope

The first release will focus on HTML and PDF content, JavaScript rendering, asynchronous crawl jobs, OpenAI and Brave provider adapters, and Docker Compose deployment.

## Status

Architecture and implementation planning are underway. Contribution guidelines and a project license will be added before outside contributions are accepted.
