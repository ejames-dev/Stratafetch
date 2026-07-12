# Release Process

Stratafetch uses quality-gated `alpha`, `beta`, release-candidate, and general-availability
releases. There is no date-based exception to a release gate.

## Versioning and tags

Use Semantic Versioning and tags of the following forms:

- `v1.0.0-alpha.N`
- `v1.0.0-beta.N`
- `v1.0.0-rc.N`
- `v1.0.0`

The root package version must equal the tag without its leading `v`. A tag is created
only from a reviewed commit on `main`; moving or replacing a published tag is prohibited.

## Required gates

- Formatting/type checks, unit, integration, security, browser, and dashboard tests pass.
- The generated OpenAPI document matches runtime Zod contracts and contains no
  unreviewed `/v1` incompatibility.
- Upgrade, backup/restore, cancellation/recovery, retention, and release Compose smoke
  tests pass.
- Linux `amd64` and `arm64` images build and start; Docker Desktop smoke tests pass on
  supported Windows and macOS hosts.
- Dependency review, secret scanning, CodeQL, and container scanning report no
  unresolved critical/high findings.
- The changelog is finalized and there are no release-blocking functional defects.

## Automated artifacts

Pushing an eligible tag runs `.github/workflows/release.yml`. It builds application,
egress, and ingress GHCR manifests for Linux `amd64` and `arm64`, signs each immutable
digest keylessly with GitHub OIDC, generates an SPDX JSON SBOM for each image, renders a
digest-pinned release Compose file, creates SHA-256 checksums, and publishes a GitHub
prerelease or release. GitHub supplies source archives.

The workflow uses protected GitHub Environments for GA publishing. Maintain branch and
tag protection, require review for workflow changes, and restrict who can approve the
`release` environment.

## Verification after publication

Install from the attached Compose file on a clean reference host, verify checksums and
the image signature, confirm readiness, and run one operation for every configured
capability. Confirm the GitHub release, GHCR manifest architectures, SBOM, changelog, and
OpenAPI artifact are accessible. Record Windows/macOS Docker Desktop results in the
release notes before promoting a release candidate to GA.
