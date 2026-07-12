# Contributing to Stratafetch

Thank you for helping improve Stratafetch. Keep pull requests focused, explain the
operator-facing impact, and call out changes to security boundaries, stored content,
provider behavior, or database migrations.

## Development setup

Requirements:

- Node.js 22 or newer and npm 10 or newer
- Docker with the Compose plugin
- Chromium installed through Playwright for browser-mode tests outside Docker

```bash
npm ci
npm run browsers:install
docker compose up -d postgres redis
npm run check
```

Run the API and worker in separate terminals with `npm run dev` and
`npm run dev:worker`. Do not use real provider credentials in tests, fixtures, logs, or
pull requests.

## Pull requests

1. Branch from the latest `main`.
2. Add tests for behavioral changes and append-only migrations for schema changes.
3. Run `npm run check` and `docker compose config --quiet`.
4. Update the OpenAPI document and relevant operator documentation when a public
   contract changes.
5. Describe validation performed and any remaining platform or security risk.

Public API compatibility is required after 1.0. Breaking `/v1` changes need a new API
version and a documented migration path. Generated artifacts must be reproducible from
tracked source; do not edit generated OpenAPI output by hand.

## Reporting security problems

Do not open a public issue for a suspected vulnerability. Follow [SECURITY.md](SECURITY.md)
so maintainers can investigate before disclosure.

By contributing, you agree that your contribution is licensed under Apache-2.0.
