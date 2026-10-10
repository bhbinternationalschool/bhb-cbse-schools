#!/usr/bin/env bash
# Artifact Registry retention for the ERP image repository.
#
# WHY THIS FILE EXISTS (2026-09-16)
# The repository had grown to 10.7 GB and the rules already in place looked
# like they were failing. They were not: "keep the 15 most recent versions"
# OVERRIDES the delete rules, and it counts per IMAGE NAME. `school-erp-worker`
# had only ever had 10 images, all from 3-4 May, so every one of them was
# protected for ever — 10.37 GB of the 10.7 GB total, for an image nothing
# deploys. It was deleted by hand; its digests are recorded in that session.
#
# The live image was fine: the 14-day rule had already cleared June, July and
# August, leaving 93 objects (31 deploys x 3 — an image plus the two companions
# Cloud Build pushes with it) for 3.28 GB.
#
# What these policies now say:
#   - untagged objects go after 3 days;
#   - anything goes after 7 days (was 14 — at 2-3 deploys a day that is still
#     ~20 images of rollback room);
#   - the 5 most recent per image are always kept, whatever their age, so a
#     rollback target can never be deleted out from under a running service.
#
# Keep the KEEP count LOW. A keep count higher than the number of images an
# abandoned package will ever have makes that package immortal, which is the
# exact trap this repository fell into.
#
# WHY curl AND NOT gcloud: `gcloud artifacts repositories update` has no
# --cleanup-policies flag in the installed SDK (565.0.0) on any surface, GA or
# beta — it only offers --upstream-policy-file, which is a different thing.
# The REST PATCH below is the same call the Cloud console makes.
#
#   ./scripts/apply-artifact-cleanup.sh
set -euo pipefail

PROJECT="${PROJECT:-school-erp-prod-493619}"
LOCATION="${LOCATION:-asia-southeast1}"
REPO="${REPO:-bhb-school-erp-repo}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BODY="$HERE/artifact-cleanup-policies.json"

echo "Applying cleanup policies to $REPO ($LOCATION)…"
# The token is read straight into the header and never printed.
http_code=$(curl -s -o /tmp/ar-cleanup-response.json -w "%{http_code}" \
  -X PATCH \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d @"$BODY" \
  "https://artifactregistry.googleapis.com/v1/projects/$PROJECT/locations/$LOCATION/repositories/$REPO?updateMask=cleanupPolicies")

if [ "$http_code" != "200" ]; then
  echo "FAILED (HTTP $http_code):"
  cat /tmp/ar-cleanup-response.json
  exit 1
fi

echo
echo "Now in force:"
gcloud artifacts repositories describe "$REPO" \
  --location="$LOCATION" --project="$PROJECT" | sed -n '1,25p'

echo
echo "Deletion runs on Google's own schedule, usually within a day."
echo "Check the size later with:"
echo "  gcloud artifacts repositories describe $REPO --location=$LOCATION --project=$PROJECT | head -3"
