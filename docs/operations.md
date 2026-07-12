# Operations Guide

This guide covers the supported self-hosted Docker Compose deployment. Production
operators are responsible for TLS termination, host patching, backups, network policy,
capacity, and provider accounts.

## Install and configure

Use the Compose file attached to the GitHub release, not the repository's development
Compose file. The release copy pins the Stratafetch image by immutable digest. Verify
`SHA256SUMS` and the image signature before starting it.

```bash
sha256sum --check SHA256SUMS
cosign verify \
  --certificate-identity-regexp '^https://github.com/ejames-dev/Stratafetch/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/ejames-dev/stratafetch@sha256:<digest>
```

Create a protected environment file with unique database credentials and at least 32
random bytes for `STRATAFETCH_ADMIN_TOKEN`. Add `BRAVE_SEARCH_API_KEY` and
`OPENAI_API_KEY` only when those capabilities are required. Bind the application to a
private interface or place it behind a TLS reverse proxy.

```bash
docker compose --env-file .env -f stratafetch-compose.yaml up -d
docker compose --env-file .env -f stratafetch-compose.yaml ps
curl --fail http://127.0.0.1:43100/health/ready
```

Do not expose PostgreSQL or Redis to untrusted networks. Monitor readiness, queue depth,
operation failure rate, content-expiry cleanup, disk utilization, and provider errors.

## Backup

A complete backup includes PostgreSQL and the deployment configuration. Redis contains
queue coordination and should be persisted, but PostgreSQL is the authoritative record
for operation state and results. Quiescing workers gives the simplest consistent
snapshot.

```bash
docker compose -f stratafetch-compose.yaml stop api worker
docker compose -f stratafetch-compose.yaml exec -T postgres \
  pg_dump --format=custom --no-owner --username=stratafetch stratafetch \
  > stratafetch-$(date -u +%Y%m%dT%H%M%SZ).dump
docker compose -f stratafetch-compose.yaml start api worker
```

Encrypt backups, store them outside the deployment host, and test restoration regularly.
Scraped content can contain sensitive or copyrighted material; apply the same access and
retention controls to backups as to the live database.

## Restore

Restore into an empty database using the same Stratafetch version that created the
backup, verify it, and only then upgrade.

```bash
docker compose -f stratafetch-compose.yaml stop api worker
docker compose -f stratafetch-compose.yaml exec -T postgres \
  dropdb --if-exists --username=stratafetch stratafetch
docker compose -f stratafetch-compose.yaml exec -T postgres \
  createdb --username=stratafetch --owner=stratafetch stratafetch
docker compose -f stratafetch-compose.yaml exec -T postgres \
  pg_restore --no-owner --exit-on-error --username=stratafetch --dbname=stratafetch \
  < stratafetch-YYYYMMDDTHHMMSSZ.dump
docker compose -f stratafetch-compose.yaml up -d
```

Confirm readiness, operation counts, and a representative result before resuming normal
traffic.

## Upgrade and migrate

1. Read the target release notes and back up PostgreSQL and configuration.
2. Download and verify the target release assets and image signature.
3. Stop API and workers, then replace the Compose file with the release attachment.
4. Start PostgreSQL and Redis, then start one API instance. Startup applies append-only
   migrations under a database advisory lock.
5. Confirm readiness and migration records before starting workers and other API
   instances.
6. Run a Fetch smoke test and inspect provider health before restoring traffic.

Never skip a release when its notes require an intermediate migration. Do not manually
edit the migration ledger.

## Rollback

Application rollback is safe only when the previous version is documented as compatible
with the upgraded schema. Otherwise stop the stack, restore the pre-upgrade database
backup, and deploy the prior digest. Preserve logs and the failed database for diagnosis
before restoring. If Redis is lost, queued work must be resubmitted with a new
idempotency key; PostgreSQL results and metadata remain durable.
