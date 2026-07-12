# Security Policy

## Supported versions

Before the 1.0 release, security fixes are provided on the latest commit of `main`.
After general availability, the latest 1.x release receives security fixes. Older
minor releases may require upgrading to receive a fix.

## Report a vulnerability

Use GitHub's private vulnerability reporting for
[ejames-dev/Stratafetch](https://github.com/ejames-dev/Stratafetch/security/advisories/new).
Do not include secrets, private scraped content, or exploit details in a public issue.

Include the affected version or commit, deployment topology, reproducible steps,
impact, and any suggested mitigation. Maintainers will acknowledge a report as soon as
practical, coordinate validation and remediation, and agree on disclosure timing with
the reporter. No fixed response-time SLA is offered by this community project.

## Security boundary

Stratafetch retrieves untrusted remote content and therefore must be deployed as a
high-risk egress workload. Application URL checks are defense in depth, not a substitute
for firewall or network-policy enforcement. Keep the API, workers, PostgreSQL, and Redis
off the public internet; expose only the intended same-origin HTTP entrypoint behind TLS.

Provider keys and `STRATAFETCH_ADMIN_TOKEN` must be supplied through the deployment
environment or a secrets manager. Rotate them after suspected disclosure. API keys are
shown once, stored only as hashes, and should use the smallest required scope.

See [docs/security.md](docs/security.md) for deployment controls and limitations.
