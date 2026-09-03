# Roadmap to 1.0 Beta

The agreed plan of record for closing the gap between what Stratafetch documents and
what it implements. Items are ordered; earlier work de-risks later work.

Status legend: `todo`, `in progress`, `done`.

## 0. Unblock the Windows dev loop - `done`

`npm run check` cannot pass on a Windows working tree. Global `core.autocrlf=true`
gives every file CRLF on disk, the repo has no `.gitattributes` to override it, and
Prettier defaults to `endOfLine: "lf"` - so `format:check` fails all 74 files while CI
passes on Linux. `.editorconfig` already declares `end_of_line = lf`, so the intent is
unambiguous.

Fix: add `.gitattributes` with `* text=auto eol=lf`, then `git add --renormalize .`.
This touches every tracked file once and should land as its own isolated commit.

A second, independent Windows blocker: `package-lock.json` contains only the Linux
platform packages for `@napi-rs/canvas` (`canvas-linux-x64-gnu`, `canvas-linux-x64-musl`)
and no `canvas-win32-x64-msvc`. `npm ci` honours the lockfile strictly, so the native
binding can never install on Windows. `pdf-parse` pulls `pdfjs-dist`, which needs that
binding to polyfill `DOMMatrix`, so `apps/api` tests fail at import for every Windows
contributor while CI stays green on Linux. The lockfile was evidently generated on Linux
only. Regenerate it so all target platforms are represented, and consider a CI matrix
entry on `windows-latest` to keep it that way.

Also observed: `node_modules` on the primary dev machine was production-pruned
(devDependencies absent). `npm ci` restores it; the prune is not reproducible from the
repo and needs no code change.

**Resolved 2026-08-29.** `.gitattributes` added (`* text=auto eol=lf`) and the working
tree renormalized to LF, dropping Prettier failures from 74 files to 0. The two files
that still differed were Prettier 3.9 union-type reflow, not line endings, and were
formatted. The lockfile was repaired surgically: the 8 missing `@napi-rs/canvas` platform
packages were spliced in from a clean resolve with zero changes to any existing pinned
version (a full regenerate would have churned 47 versions including a `cookie` major, so
it was rejected). `npm ci` now validates the lockfile, installs `canvas-win32-x64-msvc`,
and `npm run check` exits 0 on Windows with all 27 tests passing. A `cross-platform` CI
job (`windows-latest`, `macos-latest`) was added to guard against regression.

## 1. Align the scope model with the documented flow — `done`

A `shape`-scoped key can queue work it can never read. `POST /v1/shapes` returns `202`
and there is no `GET /v1/shapes/{id}`; the only way to reach the result is
`GET /v1/operations/{id}`, which requires the `admin` scope. The README quickstart has
the same defect: it issues a key scoped `fetch,survey,collect`, then instructs the reader
to poll `/v1/operations/{id}`, which returns `403 INSUFFICIENT_SCOPE`.

- Let a capability scope read and cancel the operations it created, rather than requiring
  `admin` for every read.
- Add `GET /v1/shapes/{id}` for parity with Survey and Collection.
- Update `README.md` and `docs/api.md` to match whatever rule is chosen.

**Resolved 2026-08-29.** Authorization for `GET /v1/operations/{id}`, its `/export`, and
`/cancel` is now per-operation-type: a key holding the scope that matches the operation's
type (with `collection` → `collect`) may read, export, and cancel it, so a capability key
can follow its own async work. Cross-cutting actions — the `GET /v1/operations` list,
delete, key management, and `/metrics` — stay `admin`. A new `GET /v1/shapes/{id}` gives
Shape the same typed read endpoint Survey and Collection already had. README, docs/api.md,
and the generated OpenAPI were updated to match; five authorization tests were added.

## 2. Normalize the idempotent-replay envelope — `done`

`POST /v1/fetch` and `POST /v1/search` return two different body shapes for the same
endpoint. A fresh request returns `{operationId, data: {source, content, retrieval}}`; an
`Idempotency-Key` replay returns `{data: <OperationRecord>}`. A client that retries a
request it already made gets a structurally different response.

Replay should return the stored result in the same envelope as the original.

**Resolved 2026-08-29.** A shared `replayEnvelope` helper (`apps/api/src/operations/
replay.ts`) rebuilds each endpoint's success envelope from the stored operation: a fetch
replay returns `{operationId, data}` and a search replay returns
`{data: {operationId, results}}`, matching the fresh responses. A replay of a failed
original re-raises its stored error (`502`), and a replay that races an unfinished original
returns `409 IDEMPOTENCY_IN_PROGRESS`. Covered by three tests in `app.test.ts`; `docs/api.md`
updated.

## 3. Harden and prove the egress path — `done`

**Resolved 2026-08-30 (`50a3470`).** `NODE_USE_ENV_PROXY` never actually reached the
proxy for `http://` targets on the pinned Node 22 runtime (confirmed empirically: the
request hung until timeout). Replaced with an explicit `undici.ProxyAgent` dispatcher
built once per `proxyUrl` in `fetch/service.ts` and passed to both retrievers,
matching how `browser-retriever.ts` already configured Playwright's proxy directly —
one mechanism (`EGRESS_PROXY_URL`) shared by both retrieval paths, no env-var reliance
left. The same commit scoped Squid's CONNECT-allowed ports to 80+443 (the new
dispatcher always CONNECT-tunnels, including for `http://`), ran egress as a non-root
user with no capabilities and a read-only filesystem, digest-pinned its base image and
package versions, and added `no-new-privileges` across the compose services.

Three follow-ups that commit didn't cover, closed alongside this note:
`Dockerfile`'s own base image was not digest-pinned (only `Dockerfile.egress`/
`Dockerfile.ingress` were — now `Dockerfile` is too); `compose-smoke` checked
`/health/ready` only, not a real `POST /v1/fetch` through the proxy (now asserts real
content comes back); and, found while adding that check — a genuinely broken path, not
a doc gap: `assertSafeHttpUrl`'s DNS-over-HTTPS fallback (used because `api`/`worker`
have no direct route out on the internal-only network) had no proxy dispatcher of its
own, so it silently failed too, and **every fetch against a real hostname was rejected
with `DNS_RESOLUTION_FAILED`** in the actual deployed stack. Fixed by routing it through
the same `undici.ProxyAgent` `http-retriever.ts` already builds. Also found in the
process, unrelated to the original item: `surveys/processor.ts`'s sitemap fetch was the
one outbound call in the codebase not preceded by `assertSafeHttpUrl` — fixed here too.

## 4. Rewrite the robots.txt parser — `done`

**Resolved.** `robots/service.ts` was rewritten against a test table
(`apps/api/src/robots/service.test.ts`, PR #15) covering group merging, wildcards,
anchors, longest-match precedence, and `Crawl-delay`/`Sitemap:` directives.

## 5. Backfill tests — `todo`

Untested: the auth service, `OperationRepository` (the idempotency replay/conflict SQL
is subtle), the survey processor, the shape processor, content extraction, parts of
`http-retriever` (redirect-limit exhaustion, missing `Location` header, body size cap),
and the migration runner. `App.tsx` is 1,699 lines behind one smoke test. Prefer a
Postgres service container so migrations are exercised too. Robots parsing (item 4) and
the redirect-chain SSRF re-validation in `http-retriever` are already covered.

## 6. Reconcile `docs/security.md` with the implementation — `done`

**Resolved 2026-08-30 (`50a3470`).** The doc claimed "pin the validated public address
for the connection to reduce DNS-rebinding exposure," but `assertSafeHttpUrl` resolves
DNS, checks the addresses, then discards them — no app-layer pinning was ever
implemented. Corrected to describe what actually closes the DNS-rebinding gap on the
proxied path: Squid resolves and connects to the target itself and evaluates its
IP-range rules against that resolved address, so the TOCTOU window is closed at the
proxy, not by application-layer pinning.

## Backlog

Smaller items, no fixed order:

- OpenAPI omits the entire admin surface — `/v1/admin/session`, `/v1/admin/keys`,
  `/v1/admin/keys/{id}`, `/v1/admin/providers` — and `/metrics`. `openapi:check` passes
  because it compares against the same incomplete generator.
- Survey discovery reads only `/sitemap.xml`: no sitemap-index recursion, no `.gz`, no
  `Sitemap:` from robots.txt.
- BullMQ `attempts: 3` combined with processors that call `operations.fail()` and then
  rethrow means a failing Collection re-fetches every URL up to three times and the
  operation status flaps `failed -> running -> completed`.
- `Ajv.compile()` runs on caller-supplied JSON Schema, making user-supplied `pattern`
  regexes a ReDoS vector in the worker.
- `apps/web` pins TypeScript `^5.7.2` while the root pins `7.0.2`.
- The crawler identifies as `Stratafetch/0.1` in both retrievers but `Stratafetch/1.0` in
  the robots service, against a package version of `1.0.0-alpha.1`.
- The version string is hardcoded in `app.ts` and `openapi.ts` rather than read from
  `package.json`.
