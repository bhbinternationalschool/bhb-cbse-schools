#!/usr/bin/env bash
# ONE-TIME setup: deploy school-erp-web automatically whenever a pull request
# is merged into main (cloudbuild.deploy-on-merge.yaml). Plain words:
# docs/DEPLOY_ON_MERGE.md.
#
# Run it YOURSELF, from the repo root, logged in to gcloud as the director:
#   gcloud auth login director@bhbinternational.school
#   bash scripts/setup-deploy-on-merge.sh
# It creates a Google identity and gives it permissions — that stays with a
# person. Safe to re-run: every step checks before it creates.
#
# There is ONE step you do in a browser: approving Google Cloud Build's
# access to the GitHub repository. The script stops and shows the link.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${GCP_PROJECT_ID:-school-erp-prod-493619}"
REGION="${GCP_REGION:-asia-southeast1}"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
SA_NAME="bhb-autodeploy"
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
CONNECTION="bhb-github"
REPO_NAME="bhb-cbse-schools"
REPO_URL="https://github.com/bhbinternationalschool/bhb-cbse-schools.git"
TRIGGER="deploy-on-merge"
SECRET="school-erp-deploy-env"

step() { echo; echo "── $* ──"; }

step "1/7 APIs"
gcloud services enable cloudbuild.googleapis.com secretmanager.googleapis.com run.googleapis.com --project="$PROJECT"

step "2/7 The deploy identity ($SA)"
gcloud iam service-accounts describe "$SA" --project="$PROJECT" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --project="$PROJECT" \
       --display-name="BHB deploy on merge (Cloud Build trigger)"

step "3/7 Its permissions — only what the deploy uses"
# Start and read builds (the deploy script submits the image build).
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="roles/cloudbuild.builds.editor" --condition=None >/dev/null
# Update school-erp-web and its twin school-erp-lite, and move traffic (rollback).
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="roles/run.admin" --condition=None >/dev/null
# Use the project's APIs from inside a build (the nested `gcloud builds submit`).
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="roles/serviceusage.serviceUsageConsumer" --condition=None >/dev/null
# Write this build's own logs.
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="roles/logging.logWriter" --condition=None >/dev/null
# Deploy AS the runtime identity (also the identity the image build runs as).
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --project="$PROJECT" \
  --member="serviceAccount:$SA" --role="roles/iam.serviceAccountUser" >/dev/null
# Upload the build source.
gcloud storage buckets add-iam-policy-binding "gs://${PROJECT}_cloudbuild" \
  --member="serviceAccount:$SA" --role="roles/storage.objectAdmin" >/dev/null
echo "Granted: cloudbuild.builds.editor, run.admin, serviceUsageConsumer, logging.logWriter, serviceAccountUser on the runtime SA, objectAdmin on the build bucket."

step "4/7 The deploy settings in Secret Manager ($SECRET)"
bash "$ROOT/scripts/update-deploy-env-secret.sh"
gcloud secrets add-iam-policy-binding "$SECRET" --project="$PROJECT" \
  --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor" >/dev/null
echo "Only $SA can read it."

step "5/7 Connect Cloud Build to GitHub"
if ! gcloud builds connections describe "$CONNECTION" --region="$REGION" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud builds connections create github "$CONNECTION" --region="$REGION" --project="$PROJECT"
fi
STAGE="$(gcloud builds connections describe "$CONNECTION" --region="$REGION" --project="$PROJECT" --format='value(installationState.stage)')"
if [[ "$STAGE" != "COMPLETE" ]]; then
  echo
  echo "ACTION NEEDED IN THE BROWSER:"
  gcloud builds connections describe "$CONNECTION" --region="$REGION" --project="$PROJECT" --format='value(installationState.actionUri,installationState.message)'
  echo
  echo "Open the link above, sign in to GitHub, install the Google Cloud Build app"
  echo "for the bhbinternationalschool account (the bhb-cbse-schools repository is enough),"
  echo "then run this script again. It will carry on from here."
  exit 0
fi
gcloud builds repositories describe "$REPO_NAME" --connection="$CONNECTION" --region="$REGION" --project="$PROJECT" >/dev/null 2>&1 \
  || gcloud builds repositories create "$REPO_NAME" --remote-uri="$REPO_URL" \
       --connection="$CONNECTION" --region="$REGION" --project="$PROJECT"

step "6/7 The trigger: every push to main deploys"
REPO_RES="projects/${PROJECT}/locations/${REGION}/connections/${CONNECTION}/repositories/${REPO_NAME}"
if ! gcloud builds triggers describe "$TRIGGER" --region="$REGION" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud builds triggers create github --name="$TRIGGER" --region="$REGION" --project="$PROJECT" \
    --repository="$REPO_RES" --branch-pattern='^main$' \
    --build-config=cloudbuild.deploy-on-merge.yaml \
    --service-account="projects/${PROJECT}/serviceAccounts/${SA}" \
    --include-logs-with-status \
    --description="Deploy school-erp-web when a PR is merged into main"
fi

step "7/7 Done"
echo "From now on, merging a pull request into main deploys it (about 10 minutes),"
echo "checks the reviewer login and /login, and rolls back by itself if either fails."
echo
echo "Watch builds:   https://console.cloud.google.com/cloud-build/builds;region=${REGION}?project=${PROJECT}"
echo "Deploy now without a merge:"
echo "  gcloud builds triggers run $TRIGGER --region=$REGION --project=$PROJECT --branch=main"
echo "Skip one merge: put [skip ci] in the merge commit message."
echo "After changing apps/web/.env.local: bash scripts/update-deploy-env-secret.sh"
