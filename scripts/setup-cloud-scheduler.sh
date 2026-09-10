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
    # A plain `jobs update` silently re-enables a PAUSED job. Remember the
    # state and put it back, so re-running this script never switches on a
    # feature that was paused on purpose (the staff GPS tick, 2026-08-29).
    local was_state
    was_state="$(gcloud scheduler jobs describe "$name" --location="$REGION" --format='value(state)' 2>/dev/null || true)"
    echo "Updating ${name}..."
    gcloud scheduler jobs update http "$name" \
      "${flags[@]}" --update-headers="x-cron-secret=${CRON_SECRET}"
    if [[ "$was_state" == "PAUSED" ]]; then
      echo "  ...${name} was paused; keeping it paused"
      gcloud scheduler jobs pause "$name" --location="$REGION" --quiet
    fi
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

# WhatsApp automation rules. The automation's own quiet hours default to
# 20:00-08:00, during which it sends nothing anyway, so ticking overnight
# only ever found "not now". Every 30 minutes, 08:00 to 19:59; reminders are
# day-granular and approvals are reviewed by staff in office hours.
#
# Mon-Sat, like every other school-day job here. It ran seven days a week
# while the tick only ever PROPOSED cards for a human to look at, and a card
# raised on Sunday simply waited for Monday. The tick now sends, so a Sunday
# tick is a fee chase arriving on a Sunday.
#
# 300s, not 120s, for the same reason: the tick resolves the audience from
# the roster, the fee ledger and the admissions pipeline, then posts each
# message to Meta. 120s was sized for an evaluation that did no I/O beyond
# reading and writing the rules. 300s is the ceiling worth asking for — the
# Cloud Run service takes its default 300s request timeout (no --timeout in
# cloudbuild.yaml), so a longer scheduler deadline would just wait on a
# request the platform has already cut off.
create_job "bhb-wa-automation-tick" "*/30 8-19 * * 1-6" \
  "${APP_URL}/api/wa/automation/tick" \
  "Asia/Kolkata" "300s"

# The 6 PM brief for owner, principal and office head: the day's collection
# with its mode break-up, expenses by head, attendance class by class, staff
# absences split into approved leave / awaiting a decision / nothing on file,
# and tomorrow's calling list — headlines on WhatsApp, detail in an attached
# PDF.
#
# 18:00 on school days, and once: unlike the birthday tick this is NOT
# idempotent by clock, it is idempotent by clientMessageId
# (dailybrief:<date>:<mobile>), so a retry after a timeout will not send a
# second copy. Deadline 300s because the brief reads the fee ledger, the
# registers, the leave queue and the defaulters, then renders a PDF.
create_job "bhb-daily-brief" "0 18 * * 1-6" \
  "${APP_URL}/api/reports/daily-brief/send" \
  "Asia/Kolkata" "300s"

create_job "bhb-bigquery-nightly-sync" "0 2 * * *" \
  "${APP_URL}/api/analytics/bigquery-sync/tick" \
  "Asia/Kolkata" "300s"

# Birthday greetings: the tick sends once the IST clock passes the hour set in
# Students → Birthdays (and auto-send is on); it is idempotent, so hourly is safe
# and also retries quiet-hours deferrals.
create_job "bhb-birthday-tick" "5 * * * *" \
  "${APP_URL}/api/birthday/tick" \
  "Asia/Kolkata" "300s"

# Fee integrity: money that has lost its breakdown.
#
# A live receipt with an amount and no lines has a guardian and a total and no
# student, no fee head and no month — and because dues clear FROM the lines,
# every month those families paid reads unpaid again and the counter starts
# re-collecting money it already has.
#
# This has happened twice (134 receipts on 2026-09-01, all 502 on 2026-09-06).
# Both times the Accounts controls page raised it correctly and nobody was
# looking at the Accounts controls page; the second ran about fourteen hours
# until the director noticed on his own screen. Hourly, because the cost of a
# cold start is nothing against re-collecting a family's fees.
#
# The tick returns 500 while a blank receipt exists, so Cloud Scheduler retries
# and the failure is visible in the job history — a job that only ever shows
# green teaches everyone to ignore it.
create_job "bhb-fee-integrity-tick" "35 * * * *" \
  "${APP_URL}/api/fees/integrity/tick" \
  "Asia/Kolkata" "120s"

# Ledger projection: the server book is derived from the desks (a fee receipt
# → receipt voucher, a void → reversal). It used to run only when somebody
# pressed "Project" in Accounts → Server book; over 69 voided receipts the
# reversal lagged the void by a median 3.3 h and up to 67 h. Hourly through the
# school day, Mon–Sat, at :50 so it follows the :35 integrity tick. Idempotent
# by source id; 300s because it scans every desk record.
create_job "bhb-ledger-project-tick" "50 8-15 * * 1-6" \
  "${APP_URL}/api/ledger/project/tick" \
  "Asia/Kolkata" "300s"

# The director's Monday note on fee collections: last week's receipts against
# the week before, the ageing of what is still owed, parent meetings — figures
# computed by code, a few sentences by the model with no digit in them. Goes
# to every owner on the roster (same recipients as the command digest).
create_job "bhb-collections-weekly-note" "15 8 * * 1" \
  "${APP_URL}/api/ai/collections-weekly-note?send=1" \
  "Asia/Kolkata" "300s"

# Fleet owner alerts: a bus moving outside the transport day, a tank running
# low, a service or a paper falling due. All day, every day — a bus on the
# road at midnight is exactly what the owner wants to hear about — every 15
# minutes, each alert on its own cooldown so nobody is messaged twice.
create_job "bhb-fleet-alerts-tick" "*/15 * * * *" \
  "${APP_URL}/api/transport/fleet-alerts/tick" \
  "Asia/Kolkata" "120s"

# ERP command desk: the director's end-of-day digest of what staff asked the
# ERP over WhatsApp / app / assistant. Sends once after ERP_COMMANDS_DIGEST_HOUR
# (default 19:00 IST), only on days with commands; idempotent per date, so the
# three evening attempts cover a cold start or a late command.
create_job "bhb-erp-commands-digest-tick" "20 19-21 * * *" \
  "${APP_URL}/api/erp-commands/digest/tick" \
  "Asia/Kolkata" "120s"

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

# Online classes: the "starting soon" push 15 minutes before a scheduled
# class, and closing any class still marked live half an hour after its end
# time. School hours plus an evening margin — teachers do hold revision
# classes after dinner — and never on Sunday.
create_job "bhb-online-classes-tick" "*/5 7-21 * * 1-6" \
  "${APP_URL}/api/online-classes/tick" \
  "Asia/Kolkata" "120s"

# WhatsApp template status: what Meta has approved since we last looked.
#
# A template approved at Meta but still stored as `pending` here is REFUSED by
# the sender, which falls back to plain text, which Meta rejects outside the
# 24-hour window. On 2026-09-08 `bhb_fee_receipt` had been approved in both
# languages for days while every fee receipt failed, and the error said
# "outside the 24 hour window" — pointing at the parent's silence rather than
# at a status two steps upstream. The registry had drifted to 5 approved rows
# against Meta's 64.
#
# Nothing self-corrected because there were only two paths in, and both needed
# luck: Meta's webhook wrote to a JSON file on the container disk, which Cloud
# Run wipes on every deploy and scale-to-zero, and the Masters button hands the
# merged registry to the BROWSER to save, so it cannot run unattended.
#
# School hours, because that is when an approval can be acted on and when the
# office would notice a family key that is still not sendable. Every two hours
# 08:00-16:00 Mon-Sat (5 ticks a day): approvals arrive a handful of times a
# month, so the interval is about bounding how long a silent refusal can last,
# not about catching one quickly. Idempotent — it merges Meta's statuses and
# refuses outright if the stored registry cannot be read, rather than writing
# from an empty one and erasing 67 configured templates.
create_job "bhb-wa-template-refresh" "0 8-16/2 * * 1-6" \
  "${APP_URL}/api/wa/templates/refresh" \
  "Asia/Kolkata" "120s"

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
