# Client metrics — the queries (data-layer 1.2)

What the browser and the phone now report, where it lands, and how to read it.
Written with step 1.2; nothing here has been run against production logs yet
(the code is not deployed). After the deploy, the acceptance check is: run
`bash scripts/metrics-report.sh 1` and see numbers from an office PC and a phone.

## What is logged

`POST /api/client-metrics` (signed-in only; ≤ 2 KB; 60 a minute per session;
`apps/web/src/app/api/client-metrics/route.ts`) writes one line per report.
Cloud Run turns a JSON line on stdout into `jsonPayload`:

```json
{"event":"client-metric","build":"<BUILD_ID or staff-28>","platform":"web|flutter",
 "persona":"staff","roleCode":"teacher","route":"/students","metric":"page-ready",
 "key":"nav","ms":1840,"bytes":null,"rows":null}
```

`persona` and `roleCode` come from the signed session cookie, never from the body.

| metric | sent by | `route` | `key` | `ms` means | sampling |
|---|---|---|---|---|---|
| `page-ready` | web, AppShell (`components/shell/useClientMetrics.ts`) | screen path, ids folded to `:id` | `load` (first route of the tab, from navigation start) · `nav` (from a link click / back) · `commit` (other route changes, from the render — a lower bound) | until the screen's own content is painted (`lib/pageReady.ts`): not the "Loading workspace…" / "Loading school data…" / "Checking access…" / route-skeleton placeholders | 1 in 5 |
| `desk-hydrate` | web, AppShell, on the existing `bhb-desk-first-hydrated` event | screen open at the time | desk id (`masters`, `sis`, `staff_hr`, …) | from the start of the route it arrived on (the same clock as that route's `page-ready`) until the desk's data was first in place — once per desk per page; idle-sweep desks therefore read "how long after opening the screen", not the fetch alone | 1 in 5 |
| `query` | web `lib/data/erpFetch.ts` (new code only); Flutter home calls | web: screen; Flutter: the API path | web: `METHOD /api/path`; Flutter: `GET` | the request, start to headers (web) / to body (Flutter) | 1 in 5 |
| `query-error` | the same | the same | the same | as above, or null | always (network failure or 5xx) |
| `rendered-zero-rows` | nothing yet — for the screens converted from 1.4 on | screen | list name | — (`rows` = 0) | always |

Flutter `build` is `<flavor>-<versionCode>` (`parent-28`); its home calls are
`/api/v1/parent/summary`, `/api/v1/staff/summary`, `/api/v1/principal/snapshot`,
`/api/v1/staff/approvals`, `/api/v1/comms/feed`, `/api/v1/app/popups`.

A second line, from `lib/staleBuild.server.ts`, records a write from a page on an
older build (recorded, **not refused** — see COMMAND.md step 1.2):

```json
{"event":"stale-build-write","clientBuild":"<old>","serverBuild":"<live>","method":"POST","path":"/api/data/sis.students"}
```

Only routes wrapped in `withBuildCheck` and only requests sent through `erpFetch`
produce it; in 1.2 that is `POST /api/data/<collection>`, which no screen calls yet,
so expect none until 1.4/1.5.

## The report

```bash
bash scripts/metrics-report.sh        # last 24 h
bash scripts/metrics-report.sh 6      # last 6 h
```

Prints page-ready p50/p95 per route per build, rendered-zero-rows per day (IST) per
screen, desk-hydrate p50/p95 per desk, Flutter home calls per endpoint per app build,
and stale-build writes. It only runs `gcloud logging read`.
`METRICS_INPUT=<file> bash scripts/metrics-report.sh` aggregates a saved
`--format=json` dump instead (how the script was checked before deploy).

## The raw filters

All lines, last hour:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="school-erp-web" AND jsonPayload.event="client-metric" AND timestamp>="<ISO-1h-ago>"' \
  --project=school-erp-prod-493619 --limit=5000 --format=json
```

page-ready for one screen, as a table:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="school-erp-web" AND jsonPayload.event="client-metric" AND jsonPayload.metric="page-ready" AND jsonPayload.route="/students" AND timestamp>="<ISO-24h-ago>"' \
  --project=school-erp-prod-493619 --limit=5000 \
  --format="value(timestamp,jsonPayload.build,jsonPayload.key,jsonPayload.ms,jsonPayload.roleCode)"
```

Screens that rendered an empty list:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="school-erp-web" AND jsonPayload.event="client-metric" AND jsonPayload.metric="rendered-zero-rows" AND timestamp>="<ISO-24h-ago>"' \
  --project=school-erp-prod-493619 --limit=5000 \
  --format="value(timestamp,jsonPayload.route,jsonPayload.key,jsonPayload.persona,jsonPayload.build)"
```

Which builds are still open in browsers (any metric carries its build):

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="school-erp-web" AND jsonPayload.event="client-metric" AND jsonPayload.platform="web" AND timestamp>="<ISO-24h-ago>"' \
  --project=school-erp-prod-493619 --limit=20000 --format="value(jsonPayload.build)" | sort | uniq -c
```

Writes from old builds:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="school-erp-web" AND jsonPayload.event="stale-build-write" AND timestamp>="<ISO-24h-ago>"' \
  --project=school-erp-prod-493619 --limit=5000 \
  --format="value(timestamp,jsonPayload.path,jsonPayload.clientBuild,jsonPayload.serverBuild)"
```

The `build` of a web line is `.next/BUILD_ID` (what `GET /api/app-version` answers),
not a commit. To match it to a commit, ask the revision that served it:
`curl -s https://bhbinternational.school/api/app-version` returns both `build` and
`commit` while that revision is live.
