/*
 * Three fee gaps the old SStudy ERP covered (director, 11 Oct 2026):
 * post-dated cheques, bulk payments, concession templates.
 * Screens: Fees → Bulk & PDC (/fees/tools). Pure rules: lib/feePdc.ts,
 * lib/feeBulkAllocation.ts, lib/feeConcessionTemplates.ts.
 *
 * None of these tables holds money. Receipts are still made only by the
 * counter engine (collectPayment) and written by replace_fee_desk_voucher_lines
 * in one transaction; concession grants still live in Masters and are written
 * by masters_write_slices. These rows are the register around them.
 *
 * fee_pdc_cheques — a cheque held, dated for later. Holding it pays nothing.
 *   Deposit (on/after cheque_date) makes an ordinary cheque receipt whose
 *   voucher carries transaction_id 'pdc:<id>'; fee_pdc_mark_deposited then
 *   links it, and refuses unless that voucher really is in the fee desk.
 *   Statuses move one way: held → deposited | bounced | returned | cancelled.
 *   Rows are never deleted.
 *
 * fee_bulk_payments — one payment spread over several children, one receipt
 *   per child (transaction_id 'bulk:<id>:<student>'). Written after the
 *   receipts land; a retry with the same id finds them instead of charging
 *   twice.
 *
 * fee_concession_templates — named reusable discounts. Applying one creates
 *   Masters grants under the Masters rule the template owns (rule_code).
 */

create table if not exists public.fee_pdc_cheques (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  household_id text not null,
  guardian_name text not null default '',
  cheque_no text not null,
  bank_name text not null default '',
  cheque_date date not null,
  amount_paise bigint not null check (amount_paise > 0),
  received_on date not null,
  /** [{studentId, studentName, dueKey, label, kind, amountPaise}] */
  intended jsonb not null default '[]'::jsonb,
  status text not null default 'held'
    check (status in ('held', 'deposited', 'bounced', 'returned', 'cancelled')),
  status_reason text not null default '',
  status_by text not null default '',
  status_at timestamptz,
  deposit_claimed_at timestamptz,
  voucher_id text not null default '',
  receipt_no text not null default '',
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fee_pdc_cheques_date_idx
  on public.fee_pdc_cheques (tenant_id, status, cheque_date);
create index if not exists fee_pdc_cheques_household_idx
  on public.fee_pdc_cheques (tenant_id, household_id);
-- One held/deposited cheque per (bank, number) — the same cheque entered twice
-- is a typing slip that would otherwise be deposited twice.
create unique index if not exists fee_pdc_cheques_live_cheque_uq
  on public.fee_pdc_cheques (tenant_id, lower(bank_name), cheque_no)
  where status in ('held', 'deposited');

create table if not exists public.fee_bulk_payments (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payer_label text not null default '',
  mode text not null,
  ref text not null default '',
  instrument_date date,
  bank_name text not null default '',
  collection_date date not null,
  total_paise bigint not null check (total_paise > 0),
  /** [{studentId, studentName, householdId, voucherId, receiptNo, totalPaise}] */
  receipts jsonb not null default '[]'::jsonb,
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists fee_bulk_payments_date_idx
  on public.fee_bulk_payments (tenant_id, collection_date desc);

create table if not exists public.fee_concession_templates (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  ground text not null
    check (ground in ('sibling', 'staff_ward', 'hardship', 'merit', 'rte_ews', 'director', 'correction', 'other')),
  mode text not null check (mode in ('percent', 'fixed')),
  value bigint not null check (value > 0),
  fee_head_ids text[] not null default '{}',
  sibling_child_no integer check (sibling_child_no is null or sibling_child_no >= 2),
  end_policy text not null default 'session_end' check (end_policy in ('session_end', 'open')),
  auto_approve_max_paise bigint check (auto_approve_max_paise is null or auto_approve_max_paise >= 0),
  default_reason text not null default '',
  rule_code text not null,
  is_active boolean not null default true,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fee_concession_templates_rule_code_uq
  on public.fee_concession_templates (tenant_id, rule_code);

/*
 * One live receipt per tool transaction id. The tools stamp 'pdc:<id>' and
 * 'bulk:<batch>:<student>' on the receipts they make and look for them before
 * posting; this makes "never a second receipt" hold in the database too, even
 * across two server instances racing. A voided receipt frees the id.
 *
 * Scoped to the tools' prefixes ON PURPOSE: on 11 Oct 2026 production held 99
 * groups (331 live receipts) sharing a transaction_id from older paths (counter
 * UTRs, import batches) — a school-wide unique index would fail to build and
 * would refuse legitimate history. No existing row carries either prefix.
 */
create unique index if not exists fee_desk_vouchers_tool_txn_uq
  on public.fee_desk_vouchers (tenant_id, transaction_id)
  where voided_at is null
    and (transaction_id like 'pdc:%' or transaction_id like 'bulk:%');

alter table public.fee_pdc_cheques enable row level security;
alter table public.fee_bulk_payments enable row level security;
alter table public.fee_concession_templates enable row level security;

-- Spelled out: a new table without the service_role grant fails as a bare
-- 42501 that reads like a bug in the caller.
grant select, insert, update, delete on public.fee_pdc_cheques to service_role;
grant select, insert, update, delete on public.fee_bulk_payments to service_role;
grant select, insert, update, delete on public.fee_concession_templates to service_role;

/*
 * Claim a held PDC for deposit. Two cashiers pressing Deposit at once: one
 * claim wins, the other is told to wait. A claim older than ten minutes is a
 * deposit that died half-way and may be retried (a deposit re-reads the fee
 * book, pushes it and rebuilds open dues, which can take minutes) (the receipt's transaction id
 * makes the retry find the receipt instead of making another).
 */
create or replace function public.fee_pdc_claim_deposit(p_tenant_id uuid, p_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hit text;
begin
  update public.fee_pdc_cheques
     set deposit_claimed_at = now(), updated_at = now()
   where tenant_id = p_tenant_id
     and id = p_id
     and status = 'held'
     and (deposit_claimed_at is null or deposit_claimed_at < now() - interval '10 minutes')
  returning id into v_hit;
  return v_hit is not null;
end;
$$;

/*
 * Link a PDC to the receipt its deposit made — only if that receipt is in
 * the fee desk, live, carrying this cheque's transaction id. One statement:
 * the cheque never reads "deposited" without a receipt behind it.
 */
create or replace function public.fee_pdc_mark_deposited(
  p_tenant_id uuid,
  p_id text,
  p_voucher_id text,
  p_by text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt text;
  v_hit text;
begin
  select receipt_no into v_receipt
    from public.fee_desk_vouchers
   where tenant_id = p_tenant_id
     and id = p_voucher_id
     and transaction_id = 'pdc:' || p_id
     and voided_at is null;
  if v_receipt is null then
    return jsonb_build_object('ok', false, 'error', 'The deposit receipt is not in the fee desk');
  end if;

  update public.fee_pdc_cheques
     set status = 'deposited',
         voucher_id = p_voucher_id,
         receipt_no = v_receipt,
         status_by = p_by,
         status_at = now(),
         deposit_claimed_at = null,
         updated_at = now()
   where tenant_id = p_tenant_id
     and id = p_id
     and (status = 'held' or (status = 'deposited' and voucher_id = p_voucher_id))
  returning id into v_hit;
  if v_hit is null then
    return jsonb_build_object('ok', false, 'error', 'This cheque is no longer held');
  end if;
  return jsonb_build_object('ok', true, 'receipt_no', v_receipt);
end;
$$;

revoke all on function public.fee_pdc_claim_deposit(uuid, text) from public, anon, authenticated;
revoke all on function public.fee_pdc_mark_deposited(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.fee_pdc_claim_deposit(uuid, text) to service_role;
grant execute on function public.fee_pdc_mark_deposited(uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';
