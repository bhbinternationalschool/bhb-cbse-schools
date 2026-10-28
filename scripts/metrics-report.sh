#!/usr/bin/env bash
#
# Client metrics report (data-layer 1.2) — READS Cloud Logging, writes nothing.
#
#   bash scripts/metrics-report.sh            last 24 hours
#   bash scripts/metrics-report.sh 6          last 6 hours
#   METRICS_INPUT=saved.json bash scripts/metrics-report.sh
#                                             aggregate a saved `gcloud logging
#                                             read --format=json` dump instead
#
# Prints:
#   1. page-ready p50 / p95 (ms) per route per build (web)
#   2. rendered-zero-rows per day (IST) per screen
#   3. desk-hydrate p50 / p95 per desk (ms from opening the route it arrived on)
#   4. Flutter home-call p50 / p95 per endpoint per app build, and failures
#   5. writes recorded from an older build (stale-build-write)
#
# The lines come from POST /api/client-metrics (apps/web/src/app/api/
# client-metrics/route.ts) and lib/staleBuild.server.ts. Each sampled timing
# is 1 in 5 of the real ones, so n here is about a fifth of what happened;
# percentiles are unaffected. Queries: docs/data-layer-rebuild/evidence/
# metrics-queries.md.

set -euo pipefail

HOURS="${1:-24}"
case "$HOURS" in ''|*[!0-9]*) echo "usage: $0 [hours]" >&2; exit 2 ;; esac
PROJECT="${GCP_PROJECT_ID:-school-erp-prod-493619}"
SERVICE="${SERVICE:-school-erp-web}"
LIMIT="${LIMIT:-50000}"

if [ -n "${METRICS_INPUT:-}" ]; then
  JSON="$(cat "$METRICS_INPUT")"
else
  SINCE="$(node -e 'console.log(new Date(Date.now() - Number(process.argv[1]) * 3600e3).toISOString())' "$HOURS")"
  FILTER="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\" AND (jsonPayload.event=\"client-metric\" OR jsonPayload.event=\"stale-build-write\") AND timestamp>=\"$SINCE\""
  echo "Reading $SERVICE logs since $SINCE (project $PROJECT, at most $LIMIT lines)…" >&2
  JSON="$(gcloud logging read "$FILTER" --project="$PROJECT" --limit="$LIMIT" --format=json)"
fi

printf '%s' "$JSON" | node -e '
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const entries = JSON.parse(raw || "[]");
  const rows = entries.map((e) => ({ ...(e.jsonPayload || {}), timestamp: e.timestamp })).filter((p) => p.event);
  const pct = (xs, p) => {
    if (!xs.length) return "-";
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
  };
  const group = (list, keyOf) => {
    const m = new Map();
    for (const r of list) {
      const k = keyOf(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  };
  const table = (title, head, body) => {
    console.log("\n" + title);
    if (!body.length) return console.log("  (none)");
    const all = [head, ...body].map((r) => r.map(String));
    const w = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
    for (const r of all) console.log("  " + r.map((c, i) => c.padEnd(w[i])).join("  "));
  };
  const metrics = rows.filter((r) => r.event === "client-metric");
  const ms = (list) => list.map((r) => r.ms).filter((x) => typeof x === "number");
  const istDay = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  const pageReady = metrics.filter((r) => r.metric === "page-ready" && r.platform !== "flutter");
  table("1. page-ready (ms) per route per build — web",
    ["route", "build", "start", "n", "p50", "p95"],
    group(pageReady, (r) => `${r.route}\u0000${r.build}\u0000${r.key || "-"}`).map(([k, l]) => {
      const [route, build, start] = k.split("\u0000");
      return [route, build, start, l.length, pct(ms(l), 50), pct(ms(l), 95)];
    }));

  const zero = metrics.filter((r) => r.metric === "rendered-zero-rows");
  table("2. rendered-zero-rows per day (IST) per screen",
    ["day", "route", "what", "count", "personas"],
    group(zero, (r) => `${istDay(r.timestamp)}\u0000${r.route}\u0000${r.key || "-"}`)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([k, l]) => [...k.split("\u0000"), l.length, [...new Set(l.map((r) => r.persona))].join(",")]));

  const desk = metrics.filter((r) => r.metric === "desk-hydrate");
  table("3. desk-hydrate (ms from opening the route it arrived on) per desk",
    ["desk", "n", "p50", "p95"],
    group(desk, (r) => r.key || "-").map(([k, l]) => [k, l.length, pct(ms(l), 50), pct(ms(l), 95)]));

  const flutter = metrics.filter((r) => r.platform === "flutter");
  table("4. Flutter home calls (ms) per endpoint per app build",
    ["endpoint", "build", "n ok", "p50", "p95", "failures"],
    group(flutter, (r) => `${r.route}\u0000${r.build}`).map(([k, l]) => {
      const ok = l.filter((r) => r.metric === "query");
      return [...k.split("\u0000"), ok.length, pct(ms(ok), 50), pct(ms(ok), 95), l.filter((r) => r.metric === "query-error").length];
    }));

  const stale = rows.filter((r) => r.event === "stale-build-write");
  table("5. writes from an older build (recorded, not refused)",
    ["path", "client build", "server build", "count"],
    group(stale, (r) => `${r.path}\u0000${r.clientBuild}\u0000${r.serverBuild}`).map(([k, l]) => [...k.split("\u0000"), l.length]));

  console.log(`\n${metrics.length} client-metric lines, ${stale.length} stale-build lines.`);
});
'
