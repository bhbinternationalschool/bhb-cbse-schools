#!/usr/bin/env bash
# Create Cloud Scheduler jobs for BHB ERP cron endpoints.
# Reads CRON_SECRET from apps/web/.env.local — run after deploy-online.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/apps/web/.env.local"
PROJECT_ID="${GCP_PROJECT_ID:-school-erp-prod-493619}"
REGION="${GCP_REGION:-asia-southeast1}"
APP_URL="${NEXT_PUBLIC_APP_URL_OVERRIDE:-https://bhbinternational.school}"

get_env() {
  python3 - "$ENV_FILE" "$1" <<'PY'
import sys
from pathlib import Path
path, key = sys.argv[1], sys.argv[2]
for line in Path(path).read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    if k == key:
        print(v.strip().strip('"').strip("'"), end="")
        break
PY
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

CRON_SECRET="$(get_env CRON_SECRET)"
if [[ -z "$CRON_SECRET" ]]; then
  echo "CRON_SECRET missing in $ENV_FILE"
  exit 1
fi

APP_URL="$(get_env NEXT_PUBLIC_APP_URL)"
APP_URL="${NEXT_PUBLIC_APP_URL_OVERRIDE:-${APP_URL:-https://bhbinternational.school}}"
if [[ "$APP_URL" == *"localhost"* || "$APP_URL" == *"127.0.0.1"* ]]; then
  APP_URL="https://bhbinternational.school"
  echo "Note: using production URL for scheduler (local APP_URL ignored)"
fi

if ! gcloud auth print-access-token >/dev/null 2>&1; then
  echo "Run: gcloud auth login director@bhbinternational.school --update-adc"
  exit 1
fi

gcloud config set project "$PROJECT_ID" >/dev/null

create_job() {
  local name="$1"
  local schedule="$2"
  local uri="$3"
  local tz="${4:-}"
  if gcloud scheduler jobs describe "$name" --location="$REGION" >/dev/null 2>&1; then
    echo "Updating ${name}..."
    if [[ -n "$tz" ]]; then
      gcloud scheduler jobs update http "$name" \
        --location="$REGION" \
        --schedule="$schedule" \
        --time-zone="$tz" \
        --uri="$uri" \
        --http-method=POST \
        --update-headers="x-cron-secret=${CRON_SECRET}" \
        --attempt-deadline=300s \
        --quiet
    else
      gcloud scheduler jobs update http "$name" \
        --location="$REGION" \
        --schedule="$schedule" \
        --uri="$uri" \
        --http-method=POST \
        --update-headers="x-cron-secret=${CRON_SECRET}" \
        --attempt-deadline=120s \
        --quiet
    fi
  else
    echo "Creating ${name}..."
    if [[ -n "$tz" ]]; then
      gcloud scheduler jobs create http "$name" \
        --location="$REGION" \
        --schedule="$schedule" \
        --time-zone="$tz" \
        --uri="$uri" \
        --http-method=POST \
        --headers="x-cron-secret=${CRON_SECRET}" \
        --attempt-deadline=300s \
        --quiet
    else
      gcloud scheduler jobs create http "$name" \
        --location="$REGION" \
        --schedule="$schedule" \
        --uri="$uri" \
        --http-method=POST \
        --headers="x-cron-secret=${CRON_SECRET}" \
        --attempt-deadline=120s \
        --quiet
    fi
  fi
}

create_job "bhb-comms-scheduled-publish" "*/5 * * * *" \
  "${APP_URL}/api/comms/scheduled-publish/tick"

create_job "bhb-wa-automation-tick" "*/15 * * * *" \
  "${APP_URL}/api/wa/automation/tick"

create_job "bhb-bigquery-nightly-sync" "0 2 * * *" \
  "${APP_URL}/api/analytics/bigquery-sync/tick" \
  "Asia/Kolkata"

echo ""
echo "Done. Jobs in $REGION:"
gcloud scheduler jobs list --location="$REGION" --format="table(name,schedule,state)"
