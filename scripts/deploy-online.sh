#!/usr/bin/env bash
# Deploy this CBSE Schools app to Cloud Run → bhbinternational.school
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/apps/web/.env.local"
PROJECT_ID="${GCP_PROJECT_ID:-school-erp-prod-493619}"
REGION="${GCP_REGION:-asia-southeast1}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy from StudioProjects / .env.example first"
  exit 1
fi

# Parse KEY=value (no export of secrets to shell history beyond this process)
get_env() {
  local key="$1"
  python3 - "$ENV_FILE" "$key" <<'PY'
import sys
from pathlib import Path
path, key = sys.argv[1], sys.argv[2]
for line in Path(path).read_text().splitlines():
    line=line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k,v=line.split("=",1)
    if k==key:
        print(v.strip().strip('"').strip("'"), end="")
        break
PY
}

SUPABASE_URL="$(get_env NEXT_PUBLIC_SUPABASE_URL)"
SUPABASE_ANON="$(get_env NEXT_PUBLIC_SUPABASE_ANON_KEY)"
APP_URL="${NEXT_PUBLIC_APP_URL_OVERRIDE:-https://bhbinternational.school}"
DEMO_AUTH="${NEXT_PUBLIC_DEMO_AUTH_OVERRIDE:-true}"

if [[ -z "$SUPABASE_URL" || -z "$SUPABASE_ANON" ]]; then
  echo "NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing in .env.local"
  exit 1
fi

echo "Project:  $PROJECT_ID"
echo "Region:   $REGION"
echo "App URL:  $APP_URL"
echo "Demo auth: $DEMO_AUTH"
echo "Supabase: $SUPABASE_URL"
echo ""
echo "Submitting Cloud Build (this replaces school-erp-web)…"

if ! gcloud auth print-access-token >/dev/null 2>&1; then
  echo ""
  echo "gcloud auth expired. Run this in your terminal, then re-run deploy:"
  echo "  gcloud auth login director@bhbinternational.school --update-adc"
  echo "  gcloud config set project $PROJECT_ID"
  echo "  ./scripts/deploy-online.sh"
  exit 1
fi

gcloud config set project "$PROJECT_ID" >/dev/null
gcloud config set account "${GCLOUD_ACCOUNT:-director@bhbinternational.school}" >/dev/null 2>&1 || true

gcloud builds submit "$ROOT" \
  --project="$PROJECT_ID" \
  --config="$ROOT/cloudbuild.yaml" \
  --substitutions="_NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL},_NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON},_NEXT_PUBLIC_APP_URL=${APP_URL},_NEXT_PUBLIC_DEMO_AUTH=${DEMO_AUTH},_REGION=${REGION}"

echo ""
echo "Deploy submitted. When green:"
echo "  https://bhbinternational.school/login"
echo "  gcloud run services describe school-erp-web --region=$REGION --format='value(status.url)'"
