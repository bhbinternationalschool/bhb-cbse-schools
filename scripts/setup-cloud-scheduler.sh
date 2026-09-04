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

# create_job NAME SCHEDULE URI [TZ] [DEADLINE] [START_STATE]
#
# TZ defaults to Asia/Kolkata: every schedule here is expressed in school time,
# and a job left on UTC silently runs 5h30m out when its schedule gains an
# hour-of-day restriction. DEADLINE used to be implied by whether a timezone
# was passed, which coupled two unrelated things — a */5 job that gained a
# timezone also jumped to a 300s deadline, long enough to overlap its own next
# tick. It is now explicit and defaults to 120s.
create_job() {
  local name="$1"
  local schedule="$2"
  local uri="$3"
  local tz="${4:-Asia/Kolkata}"
  local deadline="${5:-120s}"
  # "paused" => pause the job right after CREATING it. Deliberately not applied
  # on update: if someone has resumed the job on purpose, re-running this script
  # must not switch it back off.
  local start_state="${6:-}"

  local -a flags=(
    --location="$REGION"
    --schedule="$schedule"
    --time-zone="$tz"
    --uri="$uri"
    --http-method=POST
    --attempt-deadline="$deadline"
    --quiet
  )

  if gcloud scheduler jobs describe "$name" --location="$REGION" >/dev/null 2>&1; then
    echo "Updating ${name}..."
    gcloud scheduler jobs update http "$name" \
      "${flags[@]}" --update-headers="x-cron-secret=${CRON_SECRET}"
  else
    echo "Creating ${name}..."
    gcloud scheduler jobs create http "$name" \
      "${flags[@]}" --headers="x-cron-secret=${CRON_SECRET}"
    if [[ "$start_state" == "paused" ]]; then
      echo "  ...pausing ${name} (feature is off; resume when enabling it)"
      gcloud scheduler jobs pause "$name" --location="$REGION" --quiet
    fi
  fi
}

# Scheduled notices / news / gallery + social cross-post. Was */5 around the
# clock — 288 cold starts a day, the largest single line in the August cost
# audit. Now every 10 minutes from 06:00 to 21:59 (96 a day): a post is
# scheduled with a datetime picker and lands within ten minutes of it, and
# one set for the small hours goes out at 06:00 — the school has never
# published at night on purpose. If that ever changes, widen the hours here
# rather than the interval.
create_job "bhb-comms-scheduled-publish" "*/10 6-21 * * *" \
  "${APP_URL}/api/comms/scheduled-publish/tick" \
  "Asia/Kolkata" "120s"

# WhatsApp automation rules (approval-first). The automation's own quiet
# hours default to 20:00-08:00, during which it sends nothing anyway, so
# ticking overnight only ever found "not now". Every 30 minutes, 08:00 to
# 19:59 (24 a day, from 96); reminders are day-granular, approvals are
# reviewed by staff in office hours.
create_job "bhb-wa-automation-tick" "*/30 8-19 * * *" \
  "${APP_URL}/api/wa/automation/tick" \
  "Asia/Kolkata" "120s"

create_job "bhb-bigquery-nightly-sync" "0 2 * * *" \
  "${APP_URL}/api/analytics/bigquery-sync/tick" \
  "Asia/Kolkata" "300s"

# Birthday greetings: the tick sends once the IST clock passes the hour set in
# Students → Birthdays (and auto-send is on); it is idempotent, so hourly is safe
# and also retries quiet-hours deferrals.
create_job "bhb-birthday-tick" "5 * * * *" \
  "${APP_URL}/api/birthday/tick" \
  "Asia/Kolkata" "300s"

# Receipt archive: a PDF of every fee receipt into the school's Google Drive
# (Receipts / <academic year> / <month>).
#
# Once a day, after the counter closes — not on a repeating interval. Every
# tick of a job is a cold start of the service (min-instances=0) plus its
# Secret Manager reads, which is what the August bill audit traced the cost
# to; a half-hourly job would be 48 starts a day to find, most times, nothing.
# One pass at 15:45 covers the day's counter receipts and the previous
# night's online ones. Nobody waits on it: a parent opening a receipt in the
# app gets it rendered on the spot and archived as a side effect. Idempotent
# through drive_archive, so a missed day is simply picked up by the next.
# limit=120 with a 300s deadline: a day is a few dozen receipts at ~1.5s each.
create_job "bhb-drive-archive-receipts" "45 15 * * *" \
  "${APP_URL}/api/drive/archive/receipts/tick?limit=120" \
  "Asia/Kolkata" "300s"

# Staff GPS presence: evaluates geofence/staleness and alerts on state changes.
#
# PAUSED as of 2026-08-29 — the geo-fence is switched off in Staff → GPS and no
# staff have consented, so every tick was a cold start that did nothing. Resume
# it when the feature is turned on:
#   gcloud scheduler jobs resume bhb-staff-geo-tick --location=asia-southeast1
#
# The window is the configured school day (08:00-14:30 Mon-Sat) plus an hour of
# margin either side, to cover the grace and staleness settings. It ran */5 all
# day, every day, which is 288 ticks for a 6.5-hour feature.
create_job "bhb-staff-geo-tick" "*/5 7-15 * * 1-6" \
  "${APP_URL}/api/staff-geo/tick" \
  "Asia/Kolkata" "300s" "paused"

# Cashfree settlement sweep: pulls what the gateway actually paid into the
# bank, with its event-level breakdown, and posts it to the ledger.
#
# Daily rather than hourly: a T+1 cycle settles once, in the morning, and the
# sweep asks for a rolling 7-day window so a missed run, a bank holiday
# weekend, or a webhook that never arrived is picked up by the next one
# without anybody noticing it was needed. It is idempotent, so a re-run costs
# nothing but the request.
create_job "bhb-cashfree-settlement-sweep" "30 7 * * *" \
  "${APP_URL}/api/payments/cashfree/settlements" \
  "Asia/Kolkata" "300s"

echo ""
echo "Done. Jobs in $REGION:"
gcloud scheduler jobs list --location="$REGION" --format="table(name,schedule,state)"
