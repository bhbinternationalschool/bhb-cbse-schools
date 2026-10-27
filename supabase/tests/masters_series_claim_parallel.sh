#!/usr/bin/env bash
# Concurrency test for masters_series_claim
# (20261027090000_data_layer_masters_series_claim): N claims from N separate
# connections at once return N distinct, consecutive numbers past the records,
# and the counter ends right. Then: a claim that waits on the series lock
# longer than 5 s fails (55P03) and writes nothing.
#
# Runs against the E2E stack (never production — 127.0.0.1 only):
#   bash supabase/tests/masters_series_claim_parallel.sh
# (E2E_STATE_DIR as for scripts/e2e-stack.sh.) The probe school is committed so
# the other connections can see it, and is deleted at the end (also on failure).
set -euo pipefail

STATE="${E2E_STATE_DIR:-${TMPDIR:-/tmp}/bhb-e2e-stack}"
[ -f "$STATE/pg_port" ] && [ -f "$STATE/pgbin" ] || { echo "no stack is up (bash scripts/e2e-stack.sh up)" >&2; exit 1; }
PSQL="$(cat "$STATE/pgbin")/psql"
PORT="$(cat "$STATE/pg_port")"
N="${CLAIMS:-24}"
q() { "$PSQL" -X -q -At -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
fail() { echo "FAILED: $*" >&2; exit 1; }
ok() { echo "ok  $*"; }

T="$(q -c "select gen_random_uuid()")"
SFX="${T:0:8}"
OUT="$(mktemp -d)"
cleanup() {
  q -c "delete from public.fee_desk_vouchers where tenant_id = '$T';
        delete from public.masters_desk_number_series where tenant_id = '$T';
        delete from public.masters_desk_slices where tenant_id = '$T';
        delete from public.masters_desk_sync_meta where tenant_id = '$T';
        delete from public.tenants where id = '$T';" >/dev/null 2>&1 || true
  rm -rf "$OUT"
}
trap cleanup EXIT

# Production on 27 Oct: counter 701, receipts on record to RCV-00710.
q <<SQL >/dev/null
insert into public.tenants (id, slug, name) values ('$T', 'claim-par-$SFX', 'claim-par');
insert into public.masters_desk_slices (tenant_id, slice_key, payload, updated_at) values ('$T', 'numberSeries',
  '[{"id":"ns_rc_$SFX","code":"RECEIPT","prefix":"RCV-","padWidth":5,"resetOnAy":false,"nextNumber":701,"includeSessionInPrefix":false}]',
  now() - interval '1 hour');
insert into public.masters_desk_sync_meta (tenant_id, updated_at, last_updated_at) values ('$T', now() - interval '1 hour', now() - interval '1 hour');
insert into public.fee_desk_vouchers (id, tenant_id, academic_year_code, receipt_no, collection_date, transaction_date, total_paise)
  select gen_random_uuid()::text, '$T', '2026-27', 'RCV-' || lpad(i::text, 5, '0'), current_date, current_date, 100
    from generate_series(690, 710) i;
SQL

# N connections, released together: each waits for the go file, claims, and
# holds its transaction open a moment so the next claim has to wait on it.
GO="$OUT/go"
for i in $(seq 1 "$N"); do
  (
    while [ ! -f "$GO" ]; do sleep 0.01; done
    q -c "begin; select public.masters_series_claim('$T', 'RECEIPT')->>'formatted'; select pg_sleep(0.05); commit;" \
      | grep -E '^RCV-' > "$OUT/claim.$i" 2> "$OUT/err.$i"
  ) &
done
sleep 0.5
touch "$GO"
wait

GOT="$(cat "$OUT"/claim.* | sort)"
COUNT="$(printf '%s\n' "$GOT" | grep -c '^RCV-' || true)"
[ "$COUNT" = "$N" ] || { cat "$OUT"/err.* >&2; fail "$N claims answered (got $COUNT)"; }
ok "$N parallel claims all answered"
DISTINCT="$(printf '%s\n' "$GOT" | sort -u | wc -l | tr -d ' ')"
[ "$DISTINCT" = "$N" ] || fail "distinct numbers: $DISTINCT of $N — $(printf '%s\n' "$GOT" | uniq -d | tr '\n' ' ')"
ok "all $N numbers distinct"
WANT="$(for i in $(seq 711 $((710 + N))); do printf 'RCV-%05d\n' "$i"; done)"
[ "$GOT" = "$WANT" ] || fail "not RCV-00711..RCV-$(printf '%05d' $((710 + N))): $(printf '%s\n' "$GOT" | tr '\n' ' ')"
ok "consecutive RCV-00711..RCV-$(printf '%05d' $((710 + N))) — past the records, none skipped"
NEXT="$(q -c "select e->>'nextNumber' from public.masters_desk_slices s, jsonb_array_elements(s.payload) e where s.tenant_id = '$T' and s.slice_key = 'numberSeries' and e->>'code' = 'RECEIPT'")"
[ "$NEXT" = "$((711 + N))" ] || fail "counter $NEXT, expected $((711 + N))"
ok "counter ends at $NEXT"
REV="$(q -c "select e->>'_rev' from public.masters_desk_slices s, jsonb_array_elements(s.payload) e where s.tenant_id = '$T' and s.slice_key = 'numberSeries' and e->>'code' = 'RECEIPT'")"
[ "$REV" = "$((1 + N))" ] || fail "_rev $REV, expected $((1 + N)) (one step per claim)"
ok "_rev moved once per claim (1 → $REV)"

# lock_timeout: hold the series lock for 8 s; a claim gives up after 5 s.
( q -c "begin; select pg_advisory_xact_lock(hashtext('masters_desk_slices'), hashtext('$T' || '/numberSeries')); select pg_sleep(8); commit;" >/dev/null ) &
HOLDER=$!
sleep 0.5
START=$(date +%s)
if q -c "select public.masters_series_claim('$T', 'RECEIPT')" > "$OUT/held.out" 2> "$OUT/held.err"; then
  fail "a claim behind an 8 s lock should have timed out"
fi
ELAPSED=$(( $(date +%s) - START ))
grep -q "lock timeout" "$OUT/held.err" || fail "expected a lock timeout, got: $(cat "$OUT/held.err")"
[ "$ELAPSED" -ge 4 ] && [ "$ELAPSED" -le 7 ] || fail "timed out after ${ELAPSED}s, expected ~5s"
wait "$HOLDER"
NEXT2="$(q -c "select e->>'nextNumber' from public.masters_desk_slices s, jsonb_array_elements(s.payload) e where s.tenant_id = '$T' and s.slice_key = 'numberSeries' and e->>'code' = 'RECEIPT'")"
[ "$NEXT2" = "$NEXT" ] || fail "the timed-out claim moved the counter ($NEXT → $NEXT2)"
ok "a claim behind the lock gives up after ~${ELAPSED}s (lock timeout) and writes nothing"
echo "masters_series_claim_parallel: all checks passed"
