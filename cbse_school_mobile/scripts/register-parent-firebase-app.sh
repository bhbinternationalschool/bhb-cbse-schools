#!/usr/bin/env bash
# Register the parent flavour's package with Firebase and merge its client
# into android/app/google-services.json.
#
# Why this exists: the Gradle google-services plugin refuses to build a
# flavour whose applicationId has no client entry in google-services.json
# ("No matching client found for package name"). The staff package has one;
# the parent package, new in the parent/staff split, does not until it is
# registered in the Firebase project. The Firebase project IS the GCP
# project, so a gcloud user token is enough — no Firebase CLI login needed.
#
# Needs a live gcloud login (it expires every few weeks on this Mac):
#   gcloud auth login director@bhbinternational.school --update-adc
# then:
#   scripts/register-parent-firebase-app.sh
#
# Safe to re-run: an already-registered package is looked up, not re-created,
# and an existing client entry is never duplicated or overwritten.
set -euo pipefail

PROJECT="school-erp-prod-493619"
PKG="${1:-school.bhbinternational.parent}"
DISPLAY_NAME="${2:-BHB School — Parents}"
BASE="https://firebase.googleapis.com/v1beta1"

cd "$(dirname "$0")/.."
CFG="android/app/google-services.json"
[ -f "$CFG" ] || { echo "missing $CFG" >&2; exit 1; }

if ! TOKEN=$(gcloud auth print-access-token 2>/dev/null) || [ -z "$TOKEN" ]; then
  echo "gcloud has no usable credentials. Run:" >&2
  echo "  gcloud auth login director@bhbinternational.school --update-adc" >&2
  exit 1
fi

api() {
  curl -sS \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-goog-user-project: $PROJECT" \
    -H "Content-Type: application/json" \
    "$@"
}

# ---- 1. find or create the Android app -------------------------------------
APP_ID=$(api "$BASE/projects/$PROJECT/androidApps" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if "error" in d:
    sys.exit("list failed: " + json.dumps(d["error"]))
print(next((a["appId"] for a in d.get("apps", []) if a.get("packageName") == sys.argv[1]), ""))
' "$PKG")

if [ -n "$APP_ID" ]; then
  echo "already registered: $PKG -> $APP_ID"
else
  echo "registering $PKG ..."
  OP=$(api -X POST "$BASE/projects/$PROJECT/androidApps" \
        -d "{\"packageName\":\"$PKG\",\"displayName\":\"$DISPLAY_NAME\"}" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if "error" in d:
    sys.exit("create failed: " + json.dumps(d["error"]))
print(d["name"])
')
  # Creation is a long-running operation; poll it.
  for _ in $(seq 1 30); do
    APP_ID=$(api "$BASE/$OP" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if d.get("error"):
    sys.exit("operation failed: " + json.dumps(d["error"]))
print(d.get("response", {}).get("appId", "") if d.get("done") else "")
')
    [ -n "$APP_ID" ] && break
    sleep 2
  done
  [ -n "$APP_ID" ] || { echo "operation $OP did not finish; re-run to pick it up" >&2; exit 1; }
  echo "registered: $PKG -> $APP_ID"
fi

# ---- 2. fetch that app's config and merge its client into the file ---------
api "$BASE/projects/$PROJECT/androidApps/$APP_ID/config" \
  | python3 scripts/merge-google-services.py "$CFG" "$PKG"

echo
echo "Now build it:"
echo "  scripts/build.sh parent appbundle"
