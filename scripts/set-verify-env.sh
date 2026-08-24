#!/usr/bin/env bash
# Fill in the three secrets that apps/web/.env.verify.local needs.
#
# They are typed here rather than pasted into a chat or a commit: the values
# never leave this machine, are never echoed, and are never written to shell
# history.
#
# The point of the checks below is not tidiness. .env.verify.local is loaded
# with `dotenv-cli -o`, so it OVERRIDES .env.local. A production key in this
# file gives a local dev server write access to live student data — which is
# exactly how the transport desk was emptied on 2026-08-21. So every value is
# checked to belong to the verification project, and a production credential is
# refused outright rather than warned about.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/apps/web/.env.verify.local"

VERIFY_REF="tmgtivjwelxgxajkcvmx"   # BHB School — verification
PROD_REF="ymamhlcrjsuilzdonkzl"     # BHB School — PRODUCTION, must never appear here

[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE"; exit 1; }

echo "Filling in $ENV_FILE"
echo "Values are hidden as you type and are never echoed back."
echo
echo "All three come from the Supabase dashboard for the VERIFICATION project:"
echo "  https://supabase.com/dashboard/project/${VERIFY_REF}"
echo

# Read a secret without echoing it or leaving it in history.
ask() {
  local prompt="$1" __var="$2" value=""
  printf "%s\n  > " "$prompt"
  read -rs value
  printf "\n"
  printf -v "$__var" '%s' "$value"
}

fail() { echo; echo "REFUSED: $1"; echo "Nothing was written."; exit 1; }

# ── service_role key ────────────────────────────────────────────
ask "service_role key  (Project Settings -> API Keys -> service_role -> Reveal)" SR
[[ -n "$SR" ]] || fail "no value given"
[[ "$SR" == eyJ* ]] || fail "that does not look like a Supabase key (expected it to start with eyJ)"

# A Supabase key is a JWT: its middle segment names the project and the role.
# Decoding it locally is what lets this refuse a production key instead of
# cheerfully writing it into a file that overrides production config.
CLAIMS="$(printf '%s' "$SR" | cut -d. -f2 | python3 -c '
import sys, base64, json
s = sys.stdin.read().strip()
s += "=" * (-len(s) % 4)
try:
    d = json.loads(base64.urlsafe_b64decode(s))
    print(d.get("ref", ""), d.get("role", ""))
except Exception:
    print("", "")
')"
KEY_REF="$(awk "{print \$1}" <<<"$CLAIMS")"
KEY_ROLE="$(awk "{print \$2}" <<<"$CLAIMS")"

[[ "$KEY_REF" == "$PROD_REF" ]] && fail "that is the PRODUCTION service_role key (ref $PROD_REF). This file overrides production config — a live dev server would be able to write to real student data."
[[ "$KEY_REF" == "$VERIFY_REF" ]] || fail "that key belongs to project '${KEY_REF:-unknown}', not the verification project ($VERIFY_REF)"
[[ "$KEY_ROLE" == "service_role" ]] || fail "that is the '${KEY_ROLE:-unknown}' key, not service_role — the anon key cannot run migrations or seed data"
echo "  ok: service_role key for $VERIFY_REF"

# ── the two connection strings ──────────────────────────────────
check_url() {
  local url="$1" label="$2"
  [[ -n "$url" ]] || fail "no $label given"
  [[ "$url" == postgresql://* || "$url" == postgres://* ]] || fail "$label should start with postgresql://"
  [[ "$url" == *"$PROD_REF"* ]] && fail "that $label points at PRODUCTION ($PROD_REF)"
  [[ "$url" == *"$VERIFY_REF"* ]] || fail "that $label does not mention the verification project ($VERIFY_REF)"
  [[ "$url" == *"[YOUR-PASSWORD]"* || "$url" == *"YOUR-PASSWORD"* ]] && fail "$label still has the placeholder password in it — replace [YOUR-PASSWORD] with the real one"
  return 0
}

echo
ask "Transaction pooler URL, port 6543  (Project Settings -> Database -> Connection string -> Transaction pooler)" DBU
check_url "$DBU" "pooler URL"
[[ "$DBU" == *":6543"* ]] || echo "  note: that is not port 6543 — check you copied the pooler, not the direct connection"
echo "  ok: pooler URL for $VERIFY_REF"

echo
ask "Direct connection URL, port 5432  (same page -> Direct connection)" DIR
check_url "$DIR" "direct URL"
[[ "$DIR" == *":5432"* ]] || echo "  note: that is not port 5432 — check you copied the direct connection"
echo "  ok: direct URL for $VERIFY_REF"

# ── write ───────────────────────────────────────────────────────
BACKUP="${ENV_FILE}.bak.$(date +%s)"
cp "$ENV_FILE" "$BACKUP"

SR="$SR" DBU="$DBU" DIR="$DIR" ENV_FILE="$ENV_FILE" python3 - <<'PY'
import os, re
path = os.environ["ENV_FILE"]
vals = {
    "SUPABASE_SERVICE_ROLE_KEY": os.environ["SR"],
    "DATABASE_URL": os.environ["DBU"],
    "DIRECT_URL": os.environ["DIR"],
}
lines = open(path).read().splitlines()
seen = set()
out = []
for line in lines:
    m = re.match(r"^([A-Z_]+)=", line)
    if m and m.group(1) in vals:
        out.append(f"{m.group(1)}={vals[m.group(1)]}")
        seen.add(m.group(1))
    else:
        out.append(line)
missing = set(vals) - seen
if missing:
    raise SystemExit(f"Expected keys not found in the file: {', '.join(sorted(missing))}")
open(path, "w").write("\n".join(out) + "\n")
PY

chmod 600 "$ENV_FILE"
echo
echo "Written. Backup of the previous file: $BACKUP"
echo "  (delete the backup once you are happy — it holds the old placeholders only)"
echo
echo "Check it works:"
echo "  bash scripts/setup-verify-db.sh      # applies the schema to the verification project"
echo "  npm --prefix apps/web run dev:verify # runs the app against it"
