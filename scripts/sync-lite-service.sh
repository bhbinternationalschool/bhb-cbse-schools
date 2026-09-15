#!/usr/bin/env bash
# Keep `school-erp-lite` a copy of `school-erp-web` — same image, same env,
# same secrets — but billed per request instead of per instance-second.
#
# WHY TWO SERVICES (2026-09-15)
# school-erp-web runs with --no-cpu-throttling so work handed to next/server's
# after() (voice notes, office relay, document photos) and the debounced desk
# pushes actually finish. The price: CPU is billed for as long as an instance
# exists, and an instance lives ~15 minutes after its last request.
#
# Tata Fleet Edge pushes a bus position every ~22 seconds, 24 hours a day,
# parked buses included. From 10 Sep that kept a 2 vCPU instance alive around
# the clock: Cloud Run went from ₹0–8/day to ₹375–409/day with no app users
# (billing export; 349,143 CPU-seconds over 12–13 Sep = 2 vCPU × 48 h).
#
# The GPS receiver and the night-time ticks await all their work before they
# respond, so they need none of that. They go to this service instead:
# request-based billing, 1 vCPU, 2 GiB (billed only while a request runs), scales to zero — a push costs the
# milliseconds it takes, and the main service is left free to sleep at night.
#
# WHAT RUNS HERE
#   Tata Fleet Edge push   /api/transport/fleet-edge/live (URL set in Tata's portal)
#   bhb-fleet-alerts-tick, bhb-fee-integrity-tick, bhb-birthday-tick,
#   bhb-bigquery-nightly-sync   (scripts/setup-cloud-scheduler.sh, LITE_URL)
# Nothing that uses after() or a debounced desk push may be pointed here.
#
# Run after every deploy (deploy-online.sh does), or on its own:
#   bash scripts/sync-lite-service.sh
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-school-erp-prod-493619}"
REGION="${GCP_REGION:-asia-southeast1}"
SOURCE="school-erp-web"
TARGET="school-erp-lite"
TMP="$(mktemp -t lite-service.XXXXXX.json)"
trap 'rm -f "$TMP"' EXIT

gcloud run services describe "$SOURCE" --project="$PROJECT_ID" --region="$REGION" --format=json \
  | python3 - "$TARGET" > "$TMP" <<'PY'
import json, sys
target = sys.argv[1]
svc = json.load(sys.stdin)

meta = svc["metadata"]
for k in ("uid", "resourceVersion", "generation", "creationTimestamp", "selfLink"):
    meta.pop(k, None)
meta["name"] = target
keep = {"run.googleapis.com/ingress"}
meta["annotations"] = {k: v for k, v in meta.get("annotations", {}).items() if k in keep}
meta["labels"] = {k: v for k, v in meta.get("labels", {}).items() if k == "cloud.googleapis.com/location"}

tmpl = svc["spec"]["template"]
tmpl["metadata"].pop("name", None)
ann = tmpl["metadata"].setdefault("annotations", {})
ann.pop("run.googleapis.com/client-name", None)
ann.pop("run.googleapis.com/sessionAffinity", None)
ann["run.googleapis.com/cpu-throttling"] = "true"      # request-based billing
ann["autoscaling.knative.dev/minScale"] = "0"
ann["autoscaling.knative.dev/maxScale"] = "3"
ann["run.googleapis.com/startup-cpu-boost"] = "true"

spec = tmpl["spec"]
spec["containerConcurrency"] = 80
spec["timeoutSeconds"] = 300
c = spec["containers"][0]
c["resources"] = {"limits": {"cpu": "1000m", "memory": "2Gi"}}  # only billed while a request runs
# Tells the app which service it is running as (for logs; nothing branches on it yet).
env = [e for e in c.get("env", []) if e.get("name") != "ERP_SERVICE_ROLE"]
env.append({"name": "ERP_SERVICE_ROLE", "value": "lite"})
c["env"] = env

svc["spec"]["traffic"] = [{"latestRevision": True, "percent": 100}]
svc.pop("status", None)
json.dump(svc, sys.stdout)
PY

gcloud run services replace "$TMP" --project="$PROJECT_ID" --region="$REGION" --quiet >/dev/null
# Public like the main service: Tata's pushes and the scheduler carry their own
# checks (FLEET_EDGE_ALLOWED_IPS, x-cron-secret).
gcloud run services add-iam-policy-binding "$TARGET" --project="$PROJECT_ID" --region="$REGION" \
  --member=allUsers --role=roles/run.invoker --quiet >/dev/null

URL="$(gcloud run services describe "$TARGET" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
echo "school-erp-lite synced from school-erp-web: $URL"
echo "  Tata Fleet Edge push URL: $URL/api/transport/fleet-edge/live"
