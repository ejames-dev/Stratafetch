# Stratafetch

Stratafetch is a self-hosted web-data platform for discovering public URLs, retrieving
HTML and PDFs, searching the web, and transforming stored content into validated JSON.
The current package version is `1.0.0-alpha.1`; the API is being exercised against the
1.0 contract, but this is not a GA release.

## Included capabilities

- **Fetch** synchronously retrieves one page with HTTP or Playwright and stores its
  provenance and requested outputs.
- **Survey** asynchronously discovers up to 10,000 same-site URLs from sitemaps and
  bounded link traversal.
- **Collection** asynchronously retrieves up to 1,000 URLs from one completed Survey or
  an explicit URL list. Collection never performs discovery.
- **Search** returns ranked Brave Search metadata without fetching result pages.
- **Shape** uses OpenAI Structured Outputs and JSON Schema Draft 2020-12 validation to
  transform a Fetch, Collection, selected pages, or bounded inline content.
- The same-origin dashboard launches capabilities, follows operations, exports results,
  manages scoped API keys, and reports provider/system health.

Search and Shape are optional. Without their server-side credentials they return the
stable `PROVIDER_NOT_CONFIGURED` error while Fetch, Survey, and Collection remain usable.

## Quick start

Requirements are Docker with Compose, or Node.js 22 and npm 10 for local development.

```bash
cp .env.example .env
# Replace STRATAFETCH_ADMIN_TOKEN with at least 24 random characters.
docker compose up --build --detach --wait
curl --fail http://127.0.0.1:43100/health/ready
```

Open `http://localhost:43100` and authenticate with `STRATAFETCH_ADMIN_TOKEN`. The token
is exchanged for a secure HTTP-only same-site session; it is not retained by the
dashboard. Provider credentials remain environment-only.

The Compose topology keeps API, workers, PostgreSQL, and Redis on an internal network.
An ingress proxy exposes port `43100`; all outbound HTTP/browser traffic uses a separate
egress proxy that rejects loopback, private, link-local, multicast, and metadata targets.

## API keys and requests

Create a scoped key using the bootstrap token (the returned secret is shown once):

```bash
curl --request POST http://localhost:43100/v1/admin/keys \
  --header "Authorization: Bearer $STRATAFETCH_ADMIN_TOKEN" \
  --header 'content-type: application/json' \
  --data '{"name":"local-client","scopes":["fetch","survey","collect"]}'
```

Then call a capability with the issued `sf_...` key:

```bash
curl --request POST http://localhost:43100/v1/fetch \
  --header "Authorization: Bearer $STRATAFETCH_API_KEY" \
  --header 'Idempotency-Key: 0b637a8c-ffad-49d6-a0db-12de73606a14' \
  --header 'content-type: application/json' \
  --data '{"url":"https://example.org","outputs":["markdown","links"]}'
```

Survey and Collection return `202 Accepted`; poll their operation ID at
`GET /v1/operations/{id}`. Generated OpenAPI 3.1 is available at `/openapi.json` and in
[openapi.json](openapi.json). See [the API guide](docs/api.md) for the complete contract.

## Development

```bash
npm install
npm run check
npm run openapi:check
docker compose config --quiet
```

For host-based development, start PostgreSQL and Redis, then run the API/dashboard and
worker separately:

```bash
docker compose up -d postgres redis egress
npm run dev
npm run dev:worker
```

Browser retrieval outside the image also requires `npm run browsers:install`.

## Operations, security, and releases

- [Operations, backup, restore, and upgrades](docs/operations.md)
- [Deployment security and known limitations](docs/security.md)
- [Release gates and artifact verification](docs/releasing.md)
- [Contribution guide](CONTRIBUTING.md) and [security policy](SECURITY.md)

Content expires after 30 days by default; operation metadata remains until deletion.
Stratafetch respects robots.txt by default and applies bounded retries, concurrency, and
per-host delays. It does not promise CAPTCHA bypass, stealth, access-control
circumvention, or managed hosting.

Apache-2.0 licensed. See [LICENSE](LICENSE).
