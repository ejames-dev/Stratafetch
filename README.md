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

The first implementation slice is underway. The repository currently includes:

- A Node.js 22 and TypeScript workspace.
- `POST /v1/fetch` with an original request and response model.
- Standard HTTP retrieval and explicit Playwright browser rendering.
- HTML-to-Markdown, plain-text, source HTML, and link extraction.
- PDF text extraction.
- URL, DNS, redirect, response-size, and private-network safeguards.
- PostgreSQL-backed Collection records and page results.
- Redis/BullMQ-backed Collection execution in a separate worker process.
- Docker Compose services for the API, worker, PostgreSQL, and Redis.

Survey, Search, Shape, the dashboard, authentication, and provider adapters remain
planned work. Collection currently performs bounded, same-origin discovery; richer
survey rules, robots.txt policy, and scheduling controls are still to come.

## Development

Requirements:

- Node.js 22 or newer
- npm 10 or newer
- Docker with Compose for the containerized stack

Install dependencies and validate the workspace:

```bash
npm install
npm run check
```

Install Chromium when using browser-rendered fetches outside Docker:

```bash
npm run browsers:install
```

Start the backing services, API, and worker in watch mode:

```bash
cp .env.example .env
docker compose up -d postgres redis
npm run dev
```

Run the worker in a second terminal:

```bash
npm run dev:worker
```

The API listens on `http://localhost:43100` by default. Its health endpoint is
`GET /health`.

## Fetch API

Fetch a page over standard HTTP:

```bash
curl --request POST http://localhost:43100/v1/fetch \
  --header 'content-type: application/json' \
  --data '{
    "url": "https://example.com",
    "outputs": ["markdown", "text", "links"]
  }'
```

Use JavaScript rendering by setting `mode` to `browser`:

```json
{
  "url": "https://example.com/app",
  "mode": "browser",
  "outputs": ["markdown", "html"],
  "waitAfterLoadMs": 1000
}
```

`mode` defaults to `http`. Browser mode is explicit so ordinary requests do not pay
the browser startup cost and deployments without Chromium fail predictably.

## Collection API

Create a durable, asynchronous same-origin collection:

```bash
curl --request POST http://localhost:43100/v1/collections \
  --header 'content-type: application/json' \
  --data '{
    "startUrl": "https://example.com",
    "maxPages": 10,
    "mode": "http",
    "outputs": ["markdown", "text"]
  }'
```

The API returns `202 Accepted` with a collection ID. Read its status and stored page
results with:

```bash
curl http://localhost:43100/v1/collections/<collection-id>
curl http://localhost:43100/v1/collections/<collection-id>/pages
```

Collection records and page results are stored in PostgreSQL. BullMQ queues the durable
collection ID in Redis, and the worker reloads the authoritative request from PostgreSQL
before processing it. Jobs are limited to 100 pages in this initial implementation,
stay on the starting origin, and wait `COLLECTION_DELAY_MS` between pages.

## Containers

Build and start the API and its planned backing services:

```bash
docker compose up --build
```

PostgreSQL and Redis use named volumes. The example credentials in `compose.yaml` are
for local development and must be replaced before any shared or internet-facing
deployment. Their development ports bind to `127.0.0.1` only and can be changed with
`POSTGRES_PORT` and `REDIS_PORT`.

## Security boundary

Fetch rejects non-HTTP protocols, URL-embedded credentials, hostnames resolving to
non-public IP ranges, redirects to non-public targets, and responses over the configured
size limit. Browser mode also inspects subrequests before allowing them.

These application checks reduce SSRF risk, but they are not a substitute for network
egress controls. Production deployments should run fetch workers in an isolated network
that cannot reach cloud metadata endpoints or private services.

Contribution guidelines and a project license will be added before outside
contributions are accepted.
