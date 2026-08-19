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
# Production deploy URL — never read localhost from .env.local
APP_URL="${NEXT_PUBLIC_APP_URL_OVERRIDE:-https://bhbinternational.school}"
# Demo auth mints parent/staff sessions with NO credential check — it must
# NEVER be on in production. This used to default from .env.local (which is
# 'true' for local dev), so any deploy that forgot the override silently
# reopened the hole (it did, twice, on 2026-08-13). Production now defaults
# OFF; enabling demo requires an explicit NEXT_PUBLIC_DEMO_AUTH_OVERRIDE=true.
DEMO_AUTH="${NEXT_PUBLIC_DEMO_AUTH_OVERRIDE:-false}"
if [[ "$DEMO_AUTH" != "false" ]]; then
  echo "WARNING: deploying with demo auth ENABLED (NEXT_PUBLIC_DEMO_AUTH=$DEMO_AUTH) — anyone can sign in without credentials."
fi

# Optional server runtime secrets (WhatsApp, Supabase admin, job guards)
SUPABASE_SERVICE_ROLE_KEY="$(get_env SUPABASE_SERVICE_ROLE_KEY)"
CRON_SECRET="$(get_env CRON_SECRET)"
WA_DISPATCH_SECRET="$(get_env WA_DISPATCH_SECRET)"
MIRROR_SYNC_SECRET="$(get_env MIRROR_SYNC_SECRET)"
WHATSAPP_TOKEN="$(get_env WHATSAPP_TOKEN)"
WHATSAPP_PHONE_ID="$(get_env WHATSAPP_PHONE_ID)"
WHATSAPP_VERIFY_TOKEN="$(get_env WHATSAPP_VERIFY_TOKEN)"
WHATSAPP_WABA_ID="$(get_env WHATSAPP_WABA_ID)"
WHATSAPP_DEFAULT_COUNTRY_CODE="$(get_env WHATSAPP_DEFAULT_COUNTRY_CODE)"
WHATSAPP_GRAPH_VERSION="$(get_env WHATSAPP_GRAPH_VERSION)"
GOOGLE_MAPS_API_KEY="$(get_env GOOGLE_MAPS_API_KEY)"
GEMINI_API_KEY="$(get_env GEMINI_API_KEY)"
OPENAI_API_KEY="$(get_env OPENAI_API_KEY)"
AI_TUTOR_MODEL="$(get_env AI_TUTOR_MODEL)"
AI_PREFERRED_ENGINE="$(get_env AI_PREFERRED_ENGINE)"
GOOGLE_OAUTH_CLIENT_ID="$(get_env GOOGLE_OAUTH_CLIENT_ID)"
GOOGLE_OAUTH_CLIENT_SECRET="$(get_env GOOGLE_OAUTH_CLIENT_SECRET)"
NEXT_PUBLIC_VAPID_PUBLIC_KEY="$(get_env NEXT_PUBLIC_VAPID_PUBLIC_KEY)"
FLEET_EDGE_ALLOWED_IPS="$(get_env FLEET_EDGE_ALLOWED_IPS)"
FLEET_EDGE_SOS_NOTIFY_MOBILE="$(get_env FLEET_EDGE_SOS_NOTIFY_MOBILE)"

WHATSAPP_DEFAULT_COUNTRY_CODE="${WHATSAPP_DEFAULT_COUNTRY_CODE:-91}"
WHATSAPP_GRAPH_VERSION="${WHATSAPP_GRAPH_VERSION:-v21.0}"

if [[ -z "$SUPABASE_URL" || -z "$SUPABASE_ANON" ]]; then
  echo "NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing in .env.local"
  exit 1
fi

echo "Generating desk cutover env for Cloud Run + Docker build…"
python3 "$ROOT/scripts/lib/collectDeskCutoverEnv.py" "$ENV_FILE" --write
DESK_PUBLIC_COUNT="$(grep -c '^NEXT_PUBLIC_' "$ROOT/deploy/.generated/desk-cutover-build.env" 2>/dev/null || echo 0)"
DESK_RUNTIME_COUNT="$(grep -c ':' "$ROOT/deploy/.generated/desk-cutover-runtime.yaml" 2>/dev/null || echo 0)"
echo "Desk cutover: ${DESK_PUBLIC_COUNT} NEXT_PUBLIC build vars, ${DESK_RUNTIME_COUNT} runtime vars"

if [[ "${SKIP_DESK_ENV_CHECK:-}" != "1" ]]; then
  python3 "$ROOT/scripts/lib/collectDeskCutoverEnv.py" "$ENV_FILE" --check || {
    echo "Desk env check failed — copy deploy/desk-cutover.env.example into .env.local or set SKIP_DESK_ENV_CHECK=1"
    exit 1
  }
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
if [[ -n "$GEMINI_API_KEY" ]]; then
  echo "Gemini: API key present (ERP AI assistant on deploy)"
else
  echo "Gemini: not configured — ERP assistant uses offline guides only"
fi
if [[ -n "$OPENAI_API_KEY" ]]; then
  echo "OpenAI: API key present (${AI_TUTOR_MODEL:-gpt-4o-mini}, engine ${AI_PREFERRED_ENGINE:-gemini})"
else
  echo "OpenAI: not configured — AI uses Gemini only when both keys not set"
fi
if [[ -n "$GOOGLE_OAUTH_CLIENT_ID" && -n "$GOOGLE_OAUTH_CLIENT_SECRET" ]]; then
  echo "Google OAuth: configured (Classroom homework sync on deploy)"
else
  echo "Google OAuth: not configured — Classroom tab will show setup instructions"
fi
if [[ -n "$NEXT_PUBLIC_VAPID_PUBLIC_KEY" ]]; then
  echo "Web Push: VAPID public key present (private key must be in Secret Manager as school-erp-vapid-private-key)"
else
  echo "Web Push: not configured — push notifications will stay off"
fi
if [[ -n "$FLEET_EDGE_ALLOWED_IPS" ]]; then
  echo "Fleet Edge: source IP allowlist enforced ($FLEET_EDGE_ALLOWED_IPS)"
else
  echo "Fleet Edge: no IP allowlist set — webhook accepts any source (fail-open until confirmed)"
fi
if [[ -n "$FLEET_EDGE_SOS_NOTIFY_MOBILE" ]]; then
  echo "Fleet Edge: SOS/first-seen WhatsApp notify configured"
else
  echo "Fleet Edge: SOS_NOTIFY_MOBILE not set — DriverSOSAlert will log but notify no one"
fi
if [[ -n "$CRON_SECRET" ]]; then
  echo "Cron guard: CRON_SECRET present (scheduled comms + automation)"
else
  echo "Cron guard: CRON_SECRET missing — set in .env.local before production go-live"
fi
if [[ -n "$WA_DISPATCH_SECRET" ]]; then
  echo "WA dispatch: WA_DISPATCH_SECRET present"
else
  echo "WA dispatch: WA_DISPATCH_SECRET optional (staff UI works without it)"
fi
if [[ -n "$MIRROR_SYNC_SECRET" ]]; then
  echo "Mirror sync: MIRROR_SYNC_SECRET present"
else
  echo "Mirror sync: MIRROR_SYNC_SECRET optional (browser desk sync uses staff session)"
fi
BIGQUERY_PROJECT_ID="$(get_env BIGQUERY_PROJECT_ID)"
BIGQUERY_DATASET="$(get_env BIGQUERY_DATASET)"
BIGQUERY_LOCATION="$(get_env BIGQUERY_LOCATION)"
BIGQUERY_TENANT_SLUG="$(get_env BIGQUERY_TENANT_SLUG)"
DIRECT_URL="$(get_env DIRECT_URL)"
if [[ -n "$BIGQUERY_PROJECT_ID" ]]; then
  echo "BigQuery: ${BIGQUERY_PROJECT_ID}/${BIGQUERY_DATASET:-bhb_erp} (nightly sync)"
else
  echo "BigQuery: not configured — run ./scripts/setup-bigquery-gcp.sh after deploy"
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

SUBSTITUTIONS="^@^"
SUBSTITUTIONS+="_NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}"
SUBSTITUTIONS+="@_NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON}"
SUBSTITUTIONS+="@_NEXT_PUBLIC_APP_URL=${APP_URL}"
SUBSTITUTIONS+="@_NEXT_PUBLIC_DEMO_AUTH=${DEMO_AUTH}"
SUBSTITUTIONS+="@_REGION=${REGION}"
# SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_TOKEN, WHATSAPP_VERIFY_TOKEN,
# GOOGLE_MAPS_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY,
# GOOGLE_OAUTH_CLIENT_SECRET, CRON_SECRET, WA_DISPATCH_SECRET, and
# MIRROR_SYNC_SECRET are deliberately NOT passed as substitutions — they
# moved to Secret Manager and cloudbuild.yaml no longer declares these
# substitution keys, so passing them here would fail the build with "key
# ... not matched in the template" (Cloud Build rejects any --substitutions
# value for a key the config doesn't reference).
SUBSTITUTIONS+="@_WHATSAPP_PHONE_ID=${WHATSAPP_PHONE_ID}"
SUBSTITUTIONS+="@_WHATSAPP_WABA_ID=${WHATSAPP_WABA_ID}"
SUBSTITUTIONS+="@_WHATSAPP_DEFAULT_COUNTRY_CODE=${WHATSAPP_DEFAULT_COUNTRY_CODE}"
SUBSTITUTIONS+="@_WHATSAPP_GRAPH_VERSION=${WHATSAPP_GRAPH_VERSION}"
SUBSTITUTIONS+="@_AI_TUTOR_MODEL=${AI_TUTOR_MODEL:-gpt-4o-mini}"
# Default gemini (decision 2026-08-18) — "auto" here silently undid it once.
SUBSTITUTIONS+="@_AI_PREFERRED_ENGINE=${AI_PREFERRED_ENGINE:-gemini}"
SUBSTITUTIONS+="@_GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID}"
SUBSTITUTIONS+="@_NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY}"
SUBSTITUTIONS+="@_FLEET_EDGE_ALLOWED_IPS=${FLEET_EDGE_ALLOWED_IPS}"
SUBSTITUTIONS+="@_FLEET_EDGE_SOS_NOTIFY_MOBILE=${FLEET_EDGE_SOS_NOTIFY_MOBILE}"

gcloud builds submit "$ROOT" \
  --project="$PROJECT_ID" \
  --config="$ROOT/cloudbuild.yaml" \
  --substitutions="${SUBSTITUTIONS}"

echo ""
echo "Applying desk cutover env (additive update)…"
DESK_UPDATE="$(python3 "$ROOT/scripts/lib/formatDeskCutoverUpdate.py" "$ROOT/deploy/.generated/desk-cutover-runtime.yaml")"
gcloud run services update school-erp-web \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --update-env-vars="^@^${DESK_UPDATE}" \
  >/dev/null

gcloud run services update-traffic school-erp-web \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --to-latest \
  >/dev/null

if [[ -n "${BIGQUERY_PROJECT_ID:-}" ]]; then
  echo "Applying BigQuery + Postgres env on Cloud Run…"
  BQ_DATASET="${BIGQUERY_DATASET:-bhb_erp}"
  BQ_LOCATION="${BIGQUERY_LOCATION:-asia-south1}"
  BQ_TENANT="${BIGQUERY_TENANT_SLUG:-bhb-international}"
  BQ_UPDATE="BIGQUERY_PROJECT_ID=${BIGQUERY_PROJECT_ID}|BIGQUERY_DATASET=${BQ_DATASET}|BIGQUERY_LOCATION=${BQ_LOCATION}|BIGQUERY_TENANT_SLUG=${BQ_TENANT}"
  # DIRECT_URL is deliberately absent here — it moved to Secret Manager on
  # 2026-08-12 and is already applied by cloudbuild.yaml's --set-secrets in
  # the main deploy step above. Pushing it again as a plain value here hits
  # the same "already been set with a different type" error that broke this
  # whole script until this file was updated.
  gcloud run services update school-erp-web \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --update-env-vars="^|^${BQ_UPDATE}" \
    >/dev/null
fi

echo ""
echo "Deploy submitted. When green:"
echo "  https://bhbinternational.school/login"
echo "  gcloud run services describe school-erp-web --region=$REGION --format='value(status.url)'"
