# Stratafetch 1.0 API

The stable API is rooted at `/v1`. The generated OpenAPI 3.1 document is the normative
request and response reference; this guide describes the operator-facing conventions.

## Authentication and errors

Capability requests use a scoped key:

```http
Authorization: Bearer sfk_...
```

Keys have one or more of `fetch`, `survey`, `collect`, `search`, `shape`, and `admin`.
A missing or insufficient scope returns `401` or `403` without revealing whether a
resource exists. Keys are returned only when created and are stored as hashes.

A capability scope can read, export, and cancel the operations of its own type: a
`shape` key reads Shape operations, a `collect` key reads Collection operations, and so
on. Cross-cutting administration — listing every operation, deleting operations, managing
keys, and reading metrics — still requires the `admin` scope. A dashboard session has
full access.

Errors use a stable envelope:

```json
{
  "error": {
    "code": "PROVIDER_NOT_CONFIGURED",
    "message": "Brave Search is not configured.",
    "details": {}
  }
}
```

Clients should branch on `error.code`, not message text. Search and Shape return
`PROVIDER_NOT_CONFIGURED` when their environment-only provider configuration is absent.
Other capabilities remain usable.

## Idempotency and pagination

Send `Idempotency-Key` on mutating requests. Reusing a key with an identical request
returns the original operation; reusing it with different input is rejected. Generate a
new opaque key for genuinely new work.

List endpoints use opaque cursor pagination. Follow the returned `nextCursor`; do not
parse or construct cursors. Stored content expires 30 days after creation by default.
Operation metadata remains until explicitly deleted.

## Capabilities

- `POST /v1/fetch` synchronously retrieves one HTML page or PDF using HTTP or explicit
  Playwright mode. It records provenance, requested outputs, robots policy, and an
  operation ID.
- `POST /v1/surveys` queues bounded sitemap and link discovery. Discovery supports
  include/exclude patterns, depth, subdomain policy, HTTP/browser mode, and at most
  10,000 URLs.
- `POST /v1/collections` queues retrieval from exactly one Survey ID or an explicit URL
  list. It does not discover URLs and accepts at most 1,000 pages.
- `POST /v1/search` synchronously returns Brave Search ranking and URL metadata. It does
  not fetch result pages.
- `POST /v1/shapes` queues OpenAI transformation from persisted or bounded inline
  content. Output is checked against JSON Schema Draft 2020-12, with at most two repair
  attempts. `GET /v1/shapes/{id}` returns the Shape operation for the issuing `shape` key.

Asynchronous submission returns `202 Accepted` and an operation identifier. Poll progress
with `GET /v1/operations/{id}`, cancel with `POST /v1/operations/{id}/cancel`, and export
with `GET /v1/operations/{id}/export` — each usable with the capability key that created
the work, or an admin key. Cancellation is cooperative: already-running network work may
finish, but no new units are scheduled.

## Operations and administration

The API exposes operation detail, paginated results, export, and cancellation to the
capability key that created each operation. Listing every operation (`GET /v1/operations`),
deleting operations, API-key management, and metrics remain admin-scoped. The dashboard
bootstraps with `STRATAFETCH_ADMIN_TOKEN`, exchanges it for a secure HTTP-only
same-origin session, and never reads provider secrets.

Exports support JSON, JSONL, and Markdown where the underlying result has a meaningful
Markdown representation. Consumers must tolerate an item-level failure within a
partially successful Survey or Collection.
