#!/usr/bin/env bash
#
# Apply supabase/migrations to the VERIFICATION Supabase project.
#
# Why this exists: on 2026-08-21 a dev server pointed at .env.local — which is
# production — hard-deleted the live transport routes and assignments during a
# UI check. Verification now runs against its own project so a wrong click
# costs nothing.
#
# Usage:
#   VERIFY_DB_URL='postgresql://postgres:<password>@db.tmgtivjwelxgxajkcvmx.supabase.co:5432/postgres' \
#     bash scripts/setup-verify-db.sh
#
# Get that URL from the Supabase dashboard for the "BHB School — verification"
# project: Project Settings → Database → Connection string → URI. The password
# is yours; it is never read from a file here and never leaves your shell.
#
# Re-running is safe — the CLI applies only migrations the target has not seen.

set -euo pipefail

VERIFY_REF="tmgtivjwelxgxajkcvmx"
PROD_REF="ymamhlcrjsuilzdonkzl"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -z "${VERIFY_DB_URL:-}" ]]; then
  echo "VERIFY_DB_URL is not set." >&2
  echo "" >&2
  echo "  Supabase dashboard → BHB School — verification → Project Settings" >&2
  echo "  → Database → Connection string → URI, then:" >&2
  echo "" >&2
  echo "    VERIFY_DB_URL='postgresql://...' bash scripts/setup-verify-db.sh" >&2
  exit 1
fi

# The whole point of this script is to not touch production. Refuse loudly
# rather than trusting whoever set the variable.
if [[ "$VERIFY_DB_URL" == *"$PROD_REF"* ]]; then
  echo "REFUSING: VERIFY_DB_URL points at the PRODUCTION project ($PROD_REF)." >&2
  exit 2
fi

if [[ "$VERIFY_DB_URL" != *"$VERIFY_REF"* ]]; then
  echo "REFUSING: VERIFY_DB_URL does not point at the verification project" >&2
  echo "  expected host to contain: $VERIFY_REF" >&2
  exit 2
fi

echo "Target : verification project $VERIFY_REF"
echo "Source : $(ls supabase/migrations/*.sql | wc -l | tr -d ' ') migrations in supabase/migrations"
echo ""

npx --yes supabase@latest db push --db-url "$VERIFY_DB_URL" --include-all

echo ""
echo "Schema applied."
echo "Next: paste the verification service-role key into apps/web/.env.verify.local"
echo "      (SUPABASE_SERVICE_ROLE_KEY=), then run:  npm run dev:verify"
