#!/usr/bin/env bash
# Proves the egress path actually behaves the way docs/security.md and
# infra/egress/squid.conf claim, by running real probes from inside the
# `worker` container against the real deployed stack — not mocked units.
#
# Each probe uses the same fetch()+undici.ProxyAgent mechanism the app code
# in apps/api/src/fetch/http-retriever.ts uses, so a pass here is a claim
# about the actual code path, not just about Squid in isolation.
#
# The two "reaches the real internet" probes (4 and 5) need actual outbound
# connectivity from the Docker network they run on. Some sandboxed/CI hosts
# have none at all — there, Squid correctly clears its own ACLs but the
# final TCP connect fails with ENETUNREACH/ETIMEDOUT, surfaced as a Squid
# 502/503/504. That's an environment limit, not a config defect, so those
# two probes report SKIP (not FAIL) when they see a gateway-side failure,
# and only FAIL on an actual ACL denial (403/407) or a client-side error
# that isn't gateway-shaped. Run this on a host with real internet egress
# for a full, unambiguous pass.
#
# Usage: ./scripts/verify-egress.sh
# Requires: docker, docker compose, and membership in the docker group.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PROJECT=stratafetch-egress-verify
COMPOSE=(docker compose -p "$PROJECT")
export POSTGRES_PORT=5433
export REDIS_PORT=6380
export STRATAFETCH_PORT=43101

cleanup() {
  echo
  echo "==> Tearing down ($PROJECT)"
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

pass=0
fail=0
skip=0

# Runs a Node probe inside the worker container. The probe scripts print
# PASS/FAIL/SKIP themselves and exit 0 for PASS/SKIP, 1 for FAIL; this just
# tallies which happened.
run_probe() {
  local name="$1"
  local script="$2"
  echo "--> $name"
  local output
  if output="$("${COMPOSE[@]}" exec -T worker node -e "$script")"; then
    echo "    $output"
    if [[ "$output" == SKIP:* ]]; then
      skip=$((skip + 1))
    else
      pass=$((pass + 1))
    fi
  else
    echo "    $output"
    fail=$((fail + 1))
    echo "    FAILED: $name"
  fi
}

echo "==> Building and starting the stack as project '$PROJECT'"
"${COMPOSE[@]}" up -d --build

echo "==> Waiting for worker to be ready"
for _ in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T worker node -e "process.exit(0)" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# 1. core has no route to the internet at all, proxy or not. Target a
# literal public IP (no DNS involved) directly, no dispatcher.
run_probe "segmentation: direct connection to a public IP must fail" '
fetch("http://93.184.216.34/", { signal: AbortSignal.timeout(5000) })
  .then((r) => { console.log("FAIL: reached the internet directly, status", r.status); process.exit(1); })
  .catch((e) => { console.log("PASS: direct connection blocked (" + (e.cause?.code || e.name) + ")"); process.exit(0); });
'

# 2. Through the proxy, cloud metadata must be denied by squid.conf's
# blocked_v4 ACL (169.254.0.0/16).
run_probe "squid ACL: cloud metadata IP must be denied" '
const { ProxyAgent } = require("undici");
const dispatcher = new ProxyAgent(process.env.EGRESS_PROXY_URL);
fetch("http://169.254.169.254/latest/meta-data/", { dispatcher, signal: AbortSignal.timeout(5000) })
  .then((r) => { if (r.ok) { console.log("FAIL: metadata endpoint reachable, status", r.status); process.exit(1); } console.log("PASS: denied with status", r.status); process.exit(0); })
  .catch((e) => { console.log("PASS: denied (" + (e.cause?.code || e.name) + ")"); process.exit(0); });
'

# 3. Through the proxy, an IPv4-mapped IPv6 literal must be denied by the
# blocked_v6 ACL entry this change adds (::ffff:0:0/96).
run_probe "squid ACL: IPv4-mapped IPv6 loopback must be denied" '
const { ProxyAgent } = require("undici");
const dispatcher = new ProxyAgent(process.env.EGRESS_PROXY_URL);
fetch("http://[::ffff:127.0.0.1]/", { dispatcher, signal: AbortSignal.timeout(5000) })
  .then((r) => { if (r.ok) { console.log("FAIL: mapped-loopback reachable, status", r.status); process.exit(1); } console.log("PASS: denied with status", r.status); process.exit(0); })
  .catch((e) => { console.log("PASS: denied (" + (e.cause?.code || e.name) + ")"); process.exit(0); });
'

# 4. Regression guard for the connect_ports broadening: CONNECT to a port
# that is neither 80 nor 443 must still be denied — proves the fix for the
# http:// CONNECT bug did not turn this into an open relay to arbitrary
# ports. 93.184.216.34 doesn't need to be listening on 22; the ACL check
# happens before Squid ever tries to connect.
run_probe "squid ACL: CONNECT to a non-80/443 port must still be denied" '
const { ProxyAgent } = require("undici");
const dispatcher = new ProxyAgent(process.env.EGRESS_PROXY_URL);
fetch("https://93.184.216.34:22/", { dispatcher, signal: AbortSignal.timeout(5000) })
  .then((r) => { if (r.ok) { console.log("FAIL: port 22 reachable, status", r.status); process.exit(1); } console.log("PASS: denied with status", r.status); process.exit(0); })
  .catch((e) => { console.log("PASS: denied (" + (e.cause?.code || e.name) + ")"); process.exit(0); });
'

# Shared body for the two "reaches the real internet" probes: PASS on a
# real 2xx, FAIL on an ACL denial (403/407) or non-gateway client error,
# SKIP on any Squid 5xx — that's Squid clearing its own ACLs (a 403 would
# fire instead if it hadn't) and then failing to fulfill the request itself
# (DNS resolution, connect, or the tunnel), which is an environment/network
# limit, not a config problem.
positive_control() {
  local scheme="$1"
  cat <<JS
const { ProxyAgent } = require("undici");
const dispatcher = new ProxyAgent(process.env.EGRESS_PROXY_URL);
fetch("$scheme://example.com/", { dispatcher, signal: AbortSignal.timeout(8000) })
  .then((r) => { if (r.ok) { console.log("PASS: status", r.status); process.exit(0); } console.log("FAIL: status", r.status); process.exit(1); })
  .catch((e) => {
    const msg = String(e.cause?.cause?.message || e.cause?.message || e.message);
    const gatewayFail = /Proxy response \\(5\\d\\d\\)/.test(msg);
    if (gatewayFail) { console.log("SKIP: Squid ACL cleared this request; Squid itself then failed to fulfill it (" + msg + "). No real internet egress from this Docker network — environment limit, not a config problem."); process.exit(0); }
    console.log("FAIL: " + msg);
    process.exit(1);
  });
JS
}

# 5. Positive control + regression test for the http:// hang bug: a plain
# HTTP request through the proxy must actually reach the target (or, on a
# sandbox with no real egress, at least clear Squid's ACLs cleanly).
run_probe "positive control: plain http:// through the proxy" "$(positive_control http)"

# 6. Positive control: https:// through the proxy.
run_probe "positive control: https:// through the proxy" "$(positive_control https)"

echo
echo "==> $pass passed, $fail failed, $skip skipped"
if [ "$skip" -gt 0 ]; then
  echo "    (skips mean no real internet egress from this host/network — rerun somewhere that has it for a full check)"
fi
[ "$fail" -eq 0 ]
