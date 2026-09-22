#!/usr/bin/env bash
# Copy apps/web/.env.local into Secret Manager as school-erp-deploy-env, the
# settings the deploy-on-merge build deploys with (cloudbuild.deploy-on-merge.yaml).
#
# Run it after changing .env.local — a new key, a rotated token, a new
# NEXT_PUBLIC flag. Until you do, merges keep deploying with the old copy.
# It adds a new secret version; the build always reads the latest.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/apps/web/.env.local"
PROJECT_ID="${GCP_PROJECT_ID:-school-erp-prod-493619}"
SECRET="school-erp-deploy-env"

[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE"; exit 1; }
for k in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY CRON_SECRET REVIEW_LOGIN_MOBILE REVIEW_LOGIN_CODE REVIEW_LOGIN_HOUSEHOLD_ID; do
  grep -Eq "^${k}=.+" "$ENV_FILE" || { echo "Refusing: $k is empty in .env.local — a deploy from this copy would lose it."; exit 1; }
done

if ! gcloud secrets describe "$SECRET" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create "$SECRET" --project="$PROJECT_ID" --replication-policy=automatic
fi
gcloud secrets versions add "$SECRET" --project="$PROJECT_ID" --data-file="$ENV_FILE" >/dev/null
echo "Saved: $SECRET now holds this .env.local ($(wc -l < "$ENV_FILE") lines). The next merge deploys with it."
