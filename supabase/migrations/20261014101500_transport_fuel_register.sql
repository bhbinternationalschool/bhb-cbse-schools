-- Fuel register: transport_fuel_fills becomes the ONE fuel record (14 Oct 2026).
--
-- Director's decision: fuel is entered once, in Transport (web Fuel tab or the
-- driver's log book). Each fill also carries the Vehicle Fuel (5031) expense
-- voucher in Ledger v2; the office no longer types fuel bills in Accounts.
--
-- New columns on transport_fuel_fills (all defaulted, so the driver app's
-- existing inserts keep working unchanged):
--
--   fuel_type        cng / petrol / diesel / '' (unknown). A CNG+petrol bus
--                    takes both; the unit column already says kg vs litre.
--   dealer_name      the pump / dealer, free text ('' = not recorded).
--   bill_no          the pump's bill number.
--   payment_mode     '' = AWAITING OFFICE (a driver's fill: nobody has said how
--                    it was paid, so no voucher is posted). cash → Cash in
--                    Hand (1000), bank / upi → the chosen bank account,
--                    on_account → Accounts Payable (2000) against the dealer.
--   bank_account_id  the desk bank id for bank / upi.
--   payment_ref      UTR / cheque / UPI ref for bank / upi.
--   entry_source     app (driver log book) / web (Transport → Fuel) /
--                    desk_import (copied from the retired desk fuel log).
--   desk_entry_id    the desk fuelRefillLogs id an imported row came from.
--                    Unique per tenant, so the import can be re-run safely.
--   voucher_id / voucher_no / voucher_line_id
--                    the Ledger v2 voucher that carries this fill's money.
--   voucher_origin   'posted'  = this register posted it (source_type
--                                'transport_fuel_fill', source_id = fill id,
--                                so ledger_post can never post it twice);
--                    'adopted' = an Accounts expense voucher already held this
--                                exact fill (the office keyed Apr–Sep fuel in
--                                Accounts on 13 Oct); linked, never re-posted.
--   posted_at / posted_by_name, reversal_voucher_no (set when a void reversed
--   a 'posted' voucher).
--
-- APPLY BEFORE DEPLOYING the code that reads these columns.

alter table public.transport_fuel_fills
  add column if not exists fuel_type text not null default '',
  add column if not exists dealer_name text not null default '',
  add column if not exists bill_no text not null default '',
  add column if not exists payment_mode text not null default '',
  add column if not exists bank_account_id text not null default '',
  add column if not exists payment_ref text not null default '',
  add column if not exists entry_source text not null default 'app',
  add column if not exists desk_entry_id text not null default '',
  add column if not exists voucher_id uuid,
  add column if not exists voucher_no text not null default '',
  add column if not exists voucher_line_id uuid,
  add column if not exists voucher_origin text not null default '',
  add column if not exists posted_at timestamptz,
  add column if not exists posted_by_name text not null default '',
  add column if not exists reversal_voucher_no text not null default '',
  add column if not exists amended_at timestamptz,
  add column if not exists amended_by_name text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transport_fuel_fills_fuel_type_chk') then
    alter table public.transport_fuel_fills add constraint transport_fuel_fills_fuel_type_chk
      check (fuel_type in ('', 'cng', 'petrol', 'diesel'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transport_fuel_fills_payment_mode_chk') then
    alter table public.transport_fuel_fills add constraint transport_fuel_fills_payment_mode_chk
      check (payment_mode in ('', 'cash', 'bank', 'upi', 'on_account'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transport_fuel_fills_entry_source_chk') then
    alter table public.transport_fuel_fills add constraint transport_fuel_fills_entry_source_chk
      check (entry_source in ('app', 'web', 'desk_import'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transport_fuel_fills_voucher_origin_chk') then
    alter table public.transport_fuel_fills add constraint transport_fuel_fills_voucher_origin_chk
      check (
        (voucher_origin = '' and voucher_id is null)
        or (voucher_origin in ('posted', 'adopted') and voucher_id is not null)
      );
  end if;
end $$;

-- An imported desk entry lands once, however often the import is pressed.
create unique index if not exists transport_fuel_fills_desk_entry_key
  on public.transport_fuel_fills (tenant_id, desk_entry_id)
  where desk_entry_id <> '';

-- One Accounts voucher line carries at most one fill (an adopted line cannot
-- be claimed by two fills).
create unique index if not exists transport_fuel_fills_voucher_line_key
  on public.transport_fuel_fills (tenant_id, voucher_line_id)
  where voucher_line_id is not null;

-- The "awaiting office" / "not in accounts" queue.
create index if not exists transport_fuel_fills_unposted_idx
  on public.transport_fuel_fills (tenant_id, fill_date)
  where voucher_id is null and voided_at is null;

-- No new table: the grant from 20261011170000 already covers these columns.
grant select, insert, update, delete on public.transport_fuel_fills to service_role;

notify pgrst, 'reload schema';
