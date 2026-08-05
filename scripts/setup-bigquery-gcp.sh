#!/usr/bin/env bash
# BigQuery analytics warehouse — one-time GCP setup for BHB ERP.
# Reads apps/web/.env.local for DIRECT_URL, CRON_SECRET, tenant slug.
#
# Prereq (interactive, once per machine):
#   gcloud auth login director@bhbinternational.school --update-adc
#   gcloud config set project school-erp-prod-493619
#
# Usage:
#   ./scripts/setup-bigquery-gcp.sh
#   ./scripts/setup-bigquery-gcp.sh --skip-scheduler
#   ./scripts/setup-bigquery-gcp.sh --dry-run-test
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/apps/web/.env.local"
PROJECT_ID="${GCP_PROJECT_ID:-school-erp-prod-493619}"
REGION="${GCP_REGION:-asia-southeast1}"
SERVICE="${CLOUD_RUN_SERVICE:-school-erp-web}"
DATASET="${BIGQUERY_DATASET:-bhb_erp}"
BQ_LOCATION="${BIGQUERY_LOCATION:-asia-south1}"
TENANT_SLUG="${BIGQUERY_TENANT_SLUG:-bhb-international}"
SA_NAME="${BIGQUERY_SA_NAME:-bhb-erp-bigquery-sync}"
SKIP_SCHEDULER=0
DRY_RUN_TEST=0

for arg in "$@"; do
  case "$arg" in
    --skip-scheduler) SKIP_SCHEDULER=1 ;;
    --dry-run-test) DRY_RUN_TEST=1 ;;
  esac
done

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

append_env_if_missing() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    return 0
  fi
  echo "${key}=${value}" >>"$ENV_FILE"
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

if ! gcloud auth print-access-token >/dev/null 2>&1; then
  echo "gcloud auth expired. Run:"
  echo "  gcloud auth login director@bhbinternational.school --update-adc"
  echo "  gcloud config set project $PROJECT_ID"
  exit 1
fi

DIRECT_URL="$(get_env DIRECT_URL)"
CRON_SECRET="$(get_env CRON_SECRET)"
APP_URL="${NEXT_PUBLIC_APP_URL_OVERRIDE:-$(get_env NEXT_PUBLIC_APP_URL)}"
APP_URL="${APP_URL:-https://bhbinternational.school}"
if [[ "$APP_URL" == *"localhost"* ]]; then
  APP_URL="https://bhbinternational.school"
fi

echo "==> Project: $PROJECT_ID  Region: $REGION  Dataset: $DATASET ($BQ_LOCATION)"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Enabling APIs (BigQuery, Scheduler)…"
gcloud services enable bigquery.googleapis.com cloudscheduler.googleapis.com run.googleapis.com \
  --project="$PROJECT_ID" >/dev/null

echo "==> Creating dataset ${DATASET} (if missing)…"
if bq --project_id="$PROJECT_ID" show "${PROJECT_ID}:${DATASET}" >/dev/null 2>&1; then
  echo "    Dataset already exists"
else
  bq --project_id="$PROJECT_ID" --location="$BQ_LOCATION" mk --dataset "${PROJECT_ID}:${DATASET}"
fi

echo "==> Resolving Cloud Run runtime service account…"
RUN_SA="$(gcloud run services describe "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)"
if [[ -z "$RUN_SA" ]]; then
  PROJECT_NUM="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  RUN_SA="${PROJECT_NUM}-compute@developer.gserviceaccount.com"
  echo "    Cloud Run SA not set — using default compute: $RUN_SA"
else
  echo "    $RUN_SA"
fi

echo "==> Granting BigQuery roles to Cloud Run SA…"
for ROLE in roles/bigquery.dataEditor roles/bigquery.jobUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${RUN_SA}" \
    --role="$ROLE" \
    --condition=None \
    --quiet >/dev/null
done

SECRETS_DIR="${ROOT}/apps/web/.secrets"
mkdir -p "$SECRETS_DIR"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
KEY_FILE="${SECRETS_DIR}/bigquery-sync-sa.json"

if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "==> Creating local-dev service account ${SA_EMAIL}…"
  gcloud iam service-accounts create "$SA_NAME" \
    --project="$PROJECT_ID" \
    --display-name="BHB ERP BigQuery nightly sync (local dev)" \
    >/dev/null
fi

for ROLE in roles/bigquery.dataEditor roles/bigquery.jobUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$ROLE" \
    --condition=None \
    --quiet >/dev/null
done

if [[ ! -f "$KEY_FILE" ]]; then
  echo "==> Downloading key for local sync → $KEY_FILE"
  if gcloud iam service-accounts keys create "$KEY_FILE" \
    --iam-account="$SA_EMAIL" \
    --project="$PROJECT_ID" >/dev/null 2>&1; then
    append_env_if_missing "GOOGLE_APPLICATION_CREDENTIALS" "$KEY_FILE"
  else
    echo "    SA key creation blocked by org policy — using gcloud ADC for local sync"
    gcloud auth application-default set-quota-project "$PROJECT_ID" >/dev/null 2>&1 || true
    echo "    Run: gcloud auth application-default login"
  fi
else
  echo "==> Local SA key already exists ($KEY_FILE)"
  append_env_if_missing "GOOGLE_APPLICATION_CREDENTIALS" "$KEY_FILE"
fi

echo "==> Updating apps/web/.env.local BigQuery keys…"
append_env_if_missing "BIGQUERY_PROJECT_ID" "$PROJECT_ID"
append_env_if_missing "BIGQUERY_DATASET" "$DATASET"
append_env_if_missing "BIGQUERY_LOCATION" "$BQ_LOCATION"
append_env_if_missing "BIGQUERY_TENANT_SLUG" "$TENANT_SLUG"

echo "==> Patching Cloud Run ${SERVICE} env (BigQuery + DIRECT_URL)…"
UPDATE="BIGQUERY_PROJECT_ID=${PROJECT_ID}|BIGQUERY_DATASET=${DATASET}|BIGQUERY_LOCATION=${BQ_LOCATION}|BIGQUERY_TENANT_SLUG=${TENANT_SLUG}"
if [[ -n "$DIRECT_URL" ]]; then
  UPDATE="${UPDATE}|DIRECT_URL=${DIRECT_URL}"
else
  echo "    WARN: DIRECT_URL missing in .env.local — nightly sync on Cloud Run will fail until set"
fi
gcloud run services update "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --update-env-vars="^|^${UPDATE}" \
  >/dev/null

echo "==> Applying example BigQuery views…"
VIEWS_SQL="${ROOT}/apps/web/scripts/bigquery-example-views.sql"
if [[ -f "$VIEWS_SQL" ]]; then
  TMP_SQL="$(mktemp)"
  sed "s/\`bhb_erp\./\`${PROJECT_ID}.${DATASET}./g" "$VIEWS_SQL" >"$TMP_SQL"
  bq query --project_id="$PROJECT_ID" --use_legacy_sql=false --location="$BQ_LOCATION" <"$TMP_SQL" >/dev/null || {
    echo "    View creation skipped (tables empty until first sync — re-run after sync)"
  }
  rm -f "$TMP_SQL"
fi

if [[ "$SKIP_SCHEDULER" -eq 0 ]]; then
  if [[ -z "$CRON_SECRET" ]]; then
    echo "==> Skipping scheduler — CRON_SECRET missing in .env.local"
  else
    echo "==> Cloud Scheduler job (2 AM IST)…"
    "${ROOT}/scripts/setup-cloud-scheduler.sh"
  fi
else
  echo "==> Skipping scheduler (--skip-scheduler)"
fi

if [[ "$DRY_RUN_TEST" -eq 1 ]]; then
  echo "==> Local dry-run row counts…"
  (cd "${ROOT}/apps/web" && npm run sync:bigquery:dry)
fi

if [[ -n "$CRON_SECRET" ]]; then
  echo "==> Production dry-run via cron endpoint…"
  HTTP_CODE="$(curl -sS -o /tmp/bhb-bq-sync.json -w "%{http_code}" \
    -X POST "${APP_URL}/api/analytics/bigquery-sync/tick?dryRun=1" \
    -H "x-cron-secret: ${CRON_SECRET}" \
    -H "Content-Type: application/json" \
    --max-time 120 || echo "000")"
  echo "    HTTP ${HTTP_CODE}"
  if [[ -f /tmp/bhb-bq-sync.json ]]; then
    python3 -m json.tool /tmp/bhb-bq-sync.json 2>/dev/null | head -40 || cat /tmp/bhb-bq-sync.json | head -20
  fi
fi

echo ""
echo "Done."
echo "  Dataset:  https://console.cloud.google.com/bigquery?project=${PROJECT_ID}&d=${DATASET}"
echo "  Manual:   cd apps/web && npm run sync:bigquery"
echo "  Dry-run:  cd apps/web && npm run sync:bigquery:dry"
echo "  Cron:     POST ${APP_URL}/api/analytics/bigquery-sync/tick"
