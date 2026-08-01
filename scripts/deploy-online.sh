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

# Optional server runtime secrets (WhatsApp, Supabase admin, super-admin allowlist)
SUPABASE_SERVICE_ROLE_KEY="$(get_env SUPABASE_SERVICE_ROLE_KEY)"
WHATSAPP_TOKEN="$(get_env WHATSAPP_TOKEN)"
WHATSAPP_PHONE_ID="$(get_env WHATSAPP_PHONE_ID)"
WHATSAPP_VERIFY_TOKEN="$(get_env WHATSAPP_VERIFY_TOKEN)"
WHATSAPP_WABA_ID="$(get_env WHATSAPP_WABA_ID)"
WHATSAPP_DEFAULT_COUNTRY_CODE="$(get_env WHATSAPP_DEFAULT_COUNTRY_CODE)"
WHATSAPP_GRAPH_VERSION="$(get_env WHATSAPP_GRAPH_VERSION)"
GOOGLE_MAPS_API_KEY="$(get_env GOOGLE_MAPS_API_KEY)"

WHATSAPP_DEFAULT_COUNTRY_CODE="${WHATSAPP_DEFAULT_COUNTRY_CODE:-91}"
WHATSAPP_GRAPH_VERSION="${WHATSAPP_GRAPH_VERSION:-v21.0}"

if [[ -z "$SUPABASE_URL" || -z "$SUPABASE_ANON" ]]; then
  echo "NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing in .env.local"
  exit 1
fi

echo "Project:  $PROJECT_ID"
echo "Region:   $REGION"
echo "App URL:  $APP_URL"
echo "Demo auth: $DEMO_AUTH"
echo "Supabase: $SUPABASE_URL"
if [[ -n "$WHATSAPP_TOKEN" && -n "$WHATSAPP_PHONE_ID" ]]; then
  echo "WhatsApp: token + phone id present (outbound enabled on deploy)"
else
  echo "WhatsApp: not configured in .env.local — outbound will stay off"
fi
if [[ -n "$GOOGLE_MAPS_API_KEY" ]]; then
  echo "Google Maps: API key present (road distance on deploy)"
else
  echo "Google Maps: not configured — transport planner will use estimates"
fi
echo ""
echo "Submitting Cloud Build (this replaces school-erp-web)…"

# Optional: bootstrap Supabase super admin + RBAC (requires service role in .env.local)
if [[ "${SKIP_BOOTSTRAP:-}" != "1" ]] && grep -q "SUPABASE_SERVICE_ROLE_KEY=." "$ENV_FILE" 2>/dev/null; then
  echo "Running bootstrap:go-live (Supabase RBAC + director profile)…"
  (cd "$ROOT/apps/web" && npm run bootstrap:go-live) || echo "Bootstrap warning — continue deploy"
fi

if [[ "${SKIP_WA_SUBSCRIBE:-}" != "1" ]] && grep -q "WHATSAPP_TOKEN=." "$ENV_FILE" 2>/dev/null; then
  echo "Ensuring Meta app is subscribed to WABA (inbound webhooks)…"
  (cd "$ROOT/apps/web" && npm run wa:subscribe) || echo "WABA subscribe warning — continue deploy"
fi

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

# Use @ delimiter so secret values may contain commas
SUBSTITUTIONS="^@^"
SUBSTITUTIONS+="_NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}"
SUBSTITUTIONS+="@_NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON}"
SUBSTITUTIONS+="@_NEXT_PUBLIC_APP_URL=${APP_URL}"
SUBSTITUTIONS+="@_NEXT_PUBLIC_DEMO_AUTH=${DEMO_AUTH}"
SUBSTITUTIONS+="@_REGION=${REGION}"
SUBSTITUTIONS+="@_SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}"
SUBSTITUTIONS+="@_WHATSAPP_TOKEN=${WHATSAPP_TOKEN}"
SUBSTITUTIONS+="@_WHATSAPP_PHONE_ID=${WHATSAPP_PHONE_ID}"
SUBSTITUTIONS+="@_WHATSAPP_VERIFY_TOKEN=${WHATSAPP_VERIFY_TOKEN}"
SUBSTITUTIONS+="@_WHATSAPP_WABA_ID=${WHATSAPP_WABA_ID}"
SUBSTITUTIONS+="@_WHATSAPP_DEFAULT_COUNTRY_CODE=${WHATSAPP_DEFAULT_COUNTRY_CODE}"
SUBSTITUTIONS+="@_WHATSAPP_GRAPH_VERSION=${WHATSAPP_GRAPH_VERSION}"
SUBSTITUTIONS+="@_GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY}"

gcloud builds submit "$ROOT" \
  --project="$PROJECT_ID" \
  --config="$ROOT/cloudbuild.yaml" \
  --substitutions="${SUBSTITUTIONS}"

echo ""
echo "Deploy submitted. When green:"
echo "  https://bhbinternational.school/login"
echo "  gcloud run services describe school-erp-web --region=$REGION --format='value(status.url)'"
