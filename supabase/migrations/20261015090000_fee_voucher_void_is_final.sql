-- A voided fee receipt stays voided (15 Oct 2026, docs/data-layer-rebuild/
-- evidence/fees-inventory.md R1).
--
-- Every whole-desk fee push (the browser's fees-vouchers POST, the payment
-- webhooks, parent-pay, refunds, the staff-app counter) upserts receipt
-- headers last-write-wins on every column, voided_at included. A copy taken
-- before a void — a tab left open, an instance copy up to 45 s old — writes
-- voided_at = null over the void, and fee_ledger_autopost then posts the
-- receipt to the books again. Nothing in the ERP un-voids a receipt on
-- purpose (cashgramRefunds.server.ts: un-voiding "is a decision", never done
-- by machine), so a save that clears voided_at is always a stale copy.
--
-- This trigger keeps the stored void: the rest of the save is applied, the
-- void stands, and a warning names the receipt. It runs BEFORE the row is
-- written, so the AFTER trigger fee_desk_vouchers_ledger_autopost sees the
-- receipt still voided and keeps it off the books. Step 5.1b replaces the
-- whole-desk writers with fee_voucher_write/fee_voucher_void; this guard
-- stays as the database's own rule.

create or replace function public.fee_voucher_void_is_final()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.voided_at is not null and new.voided_at is null then
    new.voided_at := old.voided_at;
    raise warning 'fee_desk_vouchers %: a save tried to clear voided_at; the void stands', old.id;
  end if;
  return new;
end $$;

revoke all on function public.fee_voucher_void_is_final() from public, anon, authenticated;

drop trigger if exists a_fee_voucher_void_is_final on public.fee_desk_vouchers;
create trigger a_fee_voucher_void_is_final
  before update of voided_at on public.fee_desk_vouchers
  for each row execute function public.fee_voucher_void_is_final();
