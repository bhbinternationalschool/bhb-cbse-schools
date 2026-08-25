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
echo "NOTHING WILL APPEAR as you paste. That is deliberate, not a hang."
echo "Paste ONCE and press Enter — pasting twice silently doubles the value,"
echo "and the character count printed after each entry tells you it worked."
echo
echo "All three come from the Supabase dashboard for the VERIFICATION project:"
echo "  https://supabase.com/dashboard/project/${VERIFY_REF}"
echo

# Read a secret without echoing it or leaving it in history.
ask() {
  local prompt="$1" __var="$2" value=""
  printf "%s\n  > " "$prompt"
  read -rs value
  # Confirm something landed, without revealing any of it. A silent prompt is
  # exactly why the value gets pasted twice.
  printf "\n  (read %s characters)\n" "${#value}"
  printf -v "$__var" '%s' "$value"
}

# A pasted-twice value passes every content check — it still starts with the
# right prefix, still names the right project, still has no placeholder left in
# it. It has to be caught structurally instead.
no_whitespace() {
  case "$1" in
    *[[:space:]]*) return 1 ;;
  esac
  return 0
}

count_occurrences() {
  # rest is assigned on its own line: inside a single `local`, $haystack is not
  # yet visible, and `set -u` turns that into "unbound variable".
  local haystack="$1" needle="$2" n=0 rest
  rest="$haystack"
  while [[ "$rest" == *"$needle"* ]]; do
    rest="${rest#*"$needle"}"
    n=$((n + 1))
  done
  printf '%s' "$n"
}

fail() { echo; echo "REFUSED: $1"; echo "Nothing was written."; exit 1; }

# ── service_role key ────────────────────────────────────────────
ask "service_role key  (Project Settings -> API Keys -> service_role -> Reveal)" SR
[[ -n "$SR" ]] || fail "no value given"
no_whitespace "$SR" || fail "that value contains a space or newline — it looks like two things pasted together, or a partial copy"
[[ "$SR" == eyJ* ]] || fail "that does not look like a Supabase key (expected it to start with eyJ)"
# A JWT is exactly three dot-separated parts. Two keys pasted back to back give
# five, and would otherwise sail through every check below: cut -d. -f2 still
# finds a decodable segment in the middle of the wreckage.
SR_DOTS="$(count_occurrences "$SR" ".")"
[[ "$SR_DOTS" == "2" ]] || fail "that is not one key — a Supabase key has 3 dot-separated parts and this has $((SR_DOTS + 1)). Did it get pasted twice? Paste once; the character count after the prompt confirms it."
[[ "$(count_occurrences "$SR" "eyJ")" -le 2 ]] || fail "that looks like more than one key pasted together"

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
  no_whitespace "$url" || fail "that $label contains a space or newline — it looks like two things pasted together, or a partial copy"
  [[ "$url" == postgresql://* || "$url" == postgres://* ]] || fail "$label should start with postgresql://"
  # One URL carries exactly one scheme. "postgresql://" does NOT contain
  # "postgres://" — after "postgres" comes "q", not ":" — so these two counts do
  # not overlap and a single URL totals 1 whichever form it uses.
  local schemes
  schemes=$(( $(count_occurrences "$url" "postgresql://") + $(count_occurrences "$url" "postgres://") ))
  [[ "$schemes" -le 1 ]] || fail "that $label contains $schemes connection strings, not one. Did it get pasted twice? Paste once; the character count after the prompt confirms it."
  # NOT a refusal: a password may legitimately contain '@', and libpq splits on
  # the LAST one, so such a URL does work. Worth flagging though, because some
  # clients split on the first '@' instead and then fail confusingly.
  if [[ "$(count_occurrences "$url" "@")" != "1" ]]; then
    echo "  note: that $label has more than one '@', so the password probably contains one."
    echo "        It works here, but if another tool rejects it, encode '@' as %40."
  fi
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
