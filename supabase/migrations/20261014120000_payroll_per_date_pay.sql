-- Salary paid on each person's own date; recall reverses the book (14 Oct 2026).
--
-- Director, 14 Oct 2026: "July salary is held; I recalled it to draft; I have
-- to pay on different dates for every staff — how?"
--
-- 1. Recall. Payroll's "Recall to draft" voided only the old desk salary
--    account; the server book's accrual stayed live (PR/FY2026-27/00002 for
--    July, reversed by hand as RV/FY2026-27/00983). payroll_ledger_recall
--    reverses the run's live payroll vouchers and records the recall, in one
--    transaction — the app refuses the recall when it fails.
-- 2. Re-post. ledger_post is idempotent on (source_type, source_id) and hands
--    back a voucher even when it was reversed, so a recalled run re-posted
--    booked nothing, silently. A new version is posted under run id #2, #3 …
--    — only after a recall made here (or a hand reversal while the run was
--    back in draft, seeded below), never over a voucher an accountant
--    reversed by hand on a posted or paid run.
-- 3. Per-date pay. The payment leg was one voucher dated the run's paid day.
--    Each line now carries paid_on / paid_by / payment_ref; the book holds
--    one payment voucher per (day paid, money account), source id
--    run ':pay:' date ':' account, re-grouped when lines are marked paid or
--    un-marked. Runs paid the old way (one voucher keyed by the run id) and
--    the April runs corrected by hand are left exactly as they are.
--
-- Based on the live definition of payroll_ledger_post from
-- 20261013200000_payroll_deduction_heads.sql (md5 bcf580bded451e6b575b64ea4d04931a
-- on 14 Oct 2026); its accrual arithmetic is unchanged. Signature, SECURITY
-- DEFINER, search_path and grants are unchanged.

alter table public.payroll_desk_run_lines
  add column if not exists paid_on date,
  add column if not exists paid_by text not null default '',
  add column if not exists payment_ref text not null default '';

comment on column public.payroll_desk_run_lines.paid_on is
  'Day this person''s salary was actually paid (null = not paid yet). payment_date is the planned day.';

-- One row per recall that reversed the book. A run posts again only at a
-- later lock version than the one recorded here.
create table if not exists public.payroll_ledger_recalls (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  run_id text not null,
  month text not null default '',
  lock_version integer not null default 0,
  actor text not null default '',
  reason text not null default '',
  reversed jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists payroll_ledger_recalls_run_idx
  on public.payroll_ledger_recalls (tenant_id, run_id, created_at desc);
alter table public.payroll_ledger_recalls enable row level security;
grant select, insert on public.payroll_ledger_recalls to service_role;

-- The run a payroll voucher belongs to: 'pr_x', 'pr_x#2',
-- 'pr_x:pay:2026-07-30:cash#2', 'pr_dcnn8881:cash' → 'pr_x' / 'pr_dcnn8881'.
create or replace function public.payroll_source_run_id(p_source_id text)
returns text language sql immutable
as $$ select split_part(split_part(coalesce(p_source_id, ''), '#', 1), ':', 1) $$;

-- A versioned source id without its version: 'pr_x#3' → 'pr_x'.
create or replace function public.payroll_source_base(p_source_id text)
returns text language sql immutable
as $$ select split_part(coalesce(p_source_id, ''), '#', 1) $$;

-- What the book holds under one versioned source: the live voucher (at most
-- one), how many versions exist, and whether a new version may be posted.
-- After a reversal a new version is allowed only when the reversal was this
-- function's own regrouping of a payment, or a recall recorded at or after
-- the reversal and before the run's current lock version. A voucher reversed
-- by hand on a posted or paid run is never re-posted behind the
-- accountant's back.
create or replace function public.payroll_ledger_slot(
  p_tenant_id uuid, p_source_type text, p_base text, p_run_id text, p_lock integer
) returns table (live_id uuid, live_no text, live_paise bigint, versions integer, may_post boolean, why text)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_rev_at timestamptz; v_rev_reason text; v_rev_no text;
begin
  select count(*)::int into versions
    from public.ledger_vouchers v
   where v.tenant_id = p_tenant_id and v.source_type = p_source_type
     and (v.source_id = p_base or left(v.source_id, length(p_base) + 1) = p_base || '#');

  select v.id, v.voucher_no,
         (select coalesce(sum(l.debit_paise), 0) from public.ledger_lines l where l.voucher_id = v.id)
    into live_id, live_no, live_paise
    from public.ledger_vouchers v
   where v.tenant_id = p_tenant_id and v.source_type = p_source_type
     and (v.source_id = p_base or left(v.source_id, length(p_base) + 1) = p_base || '#')
     and not exists (select 1 from public.ledger_vouchers r
                      where r.tenant_id = p_tenant_id and r.reverses_voucher_id = v.id)
   order by v.created_at desc
   limit 1;

  if live_id is not null or versions = 0 then
    may_post := true; why := '';
    return next; return;
  end if;

  select r.created_at, r.reversal_reason, r.voucher_no
    into v_rev_at, v_rev_reason, v_rev_no
    from public.ledger_vouchers v
    join public.ledger_vouchers r on r.tenant_id = p_tenant_id and r.reverses_voucher_id = v.id
   where v.tenant_id = p_tenant_id and v.source_type = p_source_type
     and (v.source_id = p_base or left(v.source_id, length(p_base) + 1) = p_base || '#')
   order by r.created_at desc
   limit 1;

  may_post := coalesce(v_rev_reason, '') like 'Salary payments regrouped:%'
    or exists (select 1 from public.payroll_ledger_recalls c
                where c.tenant_id = p_tenant_id and c.run_id = p_run_id
                  and c.created_at >= v_rev_at and c.lock_version < p_lock);
  why := case when may_post then ''
              else 'reversed in the book by hand (' || coalesce(v_rev_no, '?') || ') — not re-posted; recall the run in Payroll to post it again' end;
  return next;
end;
$function$;
revoke all on function public.payroll_ledger_slot(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.payroll_ledger_slot(uuid, text, text, text, integer) to service_role;

CREATE OR REPLACE FUNCTION public.payroll_ledger_post(p_tenant_id uuid, p_run_id text, p_actor text DEFAULT 'system'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_run record; v_status text; v_month_end date; v_overlap int; v_reclassed int; n_lines int;
  v_gross numeric; v_net numeric; v_payable numeric; v_adv numeric; v_lwp numeric; v_late numeric;
  v_special numeric; v_total_ded numeric; v_pf_govt numeric; v_esi_govt numeric;
  v_pf_ee numeric; v_pf_er numeric; v_esi_ee numeric; v_esi_er numeric; v_rest numeric;
  v_lines jsonb; v_res jsonb; v_accrual jsonb; v_payment jsonb; v_created_by text;
  m record; v_bank text; v_code text; v_paid date; v_wallet numeric; v_adv_special numeric;
  v_slot record; v_src text; v_legacy text; v_legacy_n int; v_default_paid date; v_bases text[] := '{}';
  v_base text; v_key text; v_paise bigint; v_payments jsonb := '[]'::jsonb; v_stale record;
begin
  if not public.inv_ledger_active(p_tenant_id) then
    return jsonb_build_object('ok', false, 'refused', 'ledger not active for this tenant');
  end if;
  select * into v_run from public.payroll_desk_runs where id = p_run_id and tenant_id = p_tenant_id;
  if not found then return jsonb_build_object('ok', false, 'refused', 'no such payroll run'); end if;
  v_status := lower(coalesce(v_run.status, ''));
  if v_status not in ('posted', 'paid') then
    return jsonb_build_object('ok', true, 'skipped', 'run is ' || coalesce(nullif(v_status, ''), 'draft'));
  end if;
  -- Recalled through Payroll (payroll_ledger_recall): the book was reversed
  -- at this lock version. Until the run is posted again (a later version)
  -- this is the moment between the reversal and the browser saving the
  -- draft — nothing may be re-posted from the copy still marked posted.
  if exists (select 1 from public.payroll_ledger_recalls c
              where c.tenant_id = p_tenant_id and c.run_id = p_run_id
                and c.lock_version >= coalesce(v_run.lock_version, 0)) then
    return jsonb_build_object('ok', true, 'skipped', 'run was recalled to draft — it posts again when it is next posted');
  end if;
  if coalesce(v_run.month, '') !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object('ok', false, 'refused', 'run has no usable month');
  end if;
  v_month_end := (to_date(v_run.month || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;
  v_created_by := coalesce(nullif(p_actor, ''), nullif(v_run.posted_by, ''), nullif(v_run.approved_by, ''), 'system');

  select count(*), count(*) filter (where reclassified)
    into v_overlap, v_reclassed
    from public.payroll_ledger_overlap(p_tenant_id, v_run.month);
  if v_overlap > v_reclassed then
    raise exception 'Payroll %: % reconstructed salary voucher(s) dated the following month would be counted twice. Reclassify them first (Accounts → Server book → Payroll in the book).',
      v_run.month, v_overlap - v_reclassed;
  end if;

  select count(*), coalesce(sum(gross), 0), coalesce(sum(net_pay), 0),
         coalesce(sum(coalesce(amount_payable, net_pay)), 0), coalesce(sum(advance_deduct), 0),
         coalesce(sum(lwp_deduction), 0), coalesce(sum(late_penalty), 0), coalesce(sum(special_deduction), 0),
         coalesce(sum(total_deductions), 0), coalesce(sum(pf_govt_deposit), 0), coalesce(sum(esic_govt_deposit), 0)
    into n_lines, v_gross, v_net, v_payable, v_adv, v_lwp, v_late, v_special, v_total_ded, v_pf_govt, v_esi_govt
    from public.payroll_desk_run_lines where run_id = p_run_id and tenant_id = p_tenant_id;
  if n_lines = 0 then return jsonb_build_object('ok', false, 'refused', 'run has no staff lines'); end if;
  if v_gross <= 0 then return jsonb_build_object('ok', false, 'refused', 'run has no gross pay'); end if;

  -- Loss of pay and advance recoveries, line by line (13 Oct 2026).
  --
  -- The run-wide sums above compared the LWP column with total deductions
  -- for the whole run. When a line's LWP COMPONENT (what was actually
  -- deducted) differed from its attendance LWP column, the run gave up on
  -- LWP entirely and every rupee of it landed in 2300 Statutory Dues as if
  -- owed to the government, overstating salary expense (Prashant Dev,
  -- Devendra Kumar Pandey, May 2026). Per line, the expense is reduced by
  -- what was deducted as LWP, never by more than attendance supports; any
  -- excess stays "other deductions withheld" (Anjali Mishra, April 2026:
  -- an earlier UPI payment folded into the LWP figure).
  --
  -- A special deduction labelled as an advance is an advance recovered and
  -- reduces 1070 Staff Advances, not Statutory Dues (Deepak, April 2026:
  -- "old advance"). It does not reduce the advance register on the Staff
  -- advances desk: recoveries meant to be tracked there belong in the
  -- line's Advance deduction, which is capped by what is outstanding.
  select coalesce(sum(x.lwp), 0), coalesce(sum(x.adv_special), 0)
    into v_lwp, v_adv_special
    from public.payroll_desk_run_lines l
    cross join lateral (
      select coalesce(sum(case when (c->>'amount') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$'
                               then (c->>'amount')::numeric end)
               filter (where c->>'kind' = 'deduction' and c->>'headCode' = 'LWP'), 0) as comp
        from jsonb_array_elements(coalesce(l.components, '[]'::jsonb)) c
    ) lc
    cross join lateral (
      select case
               when lc.comp > 0 and coalesce(l.lwp_deduction, 0) > 0 then least(lc.comp, l.lwp_deduction)
               when lc.comp > 0 then lc.comp
               else coalesce(l.lwp_deduction, 0)
             end as lwp,
             case
               when coalesce(l.special_deduction, 0) > 0
                -- Only a label that names an advance being recovered:
                -- "advance", "old advance", "staff/salary advance",
                -- "advance recovery/recovered/deduction". Not "advance
                -- tax", "no advance", or a sentence that mentions one.
                and coalesce(l.special_deduction_label, '')
                    ~* '^\s*(old\s+)?((staff|salary)\s+)?advance(\s+(recovery|recovered|deduction|deducted))?\s*$'
               then l.special_deduction else 0
             end as adv_special
    ) x
   where l.run_id = p_run_id and l.tenant_id = p_tenant_id;
  v_adv := v_adv + v_adv_special;
  v_special := v_special - v_adv_special;

  select coalesce(sum(case when c->>'kind' = 'deduction' and c->>'headCode' = 'PF_EE' then (c->>'amount')::numeric end), 0),
         coalesce(sum(case when c->>'kind' = 'employer'  and c->>'headCode' = 'PF_ER' then (c->>'amount')::numeric end), 0),
         coalesce(sum(case when c->>'kind' = 'deduction' and c->>'headCode' in ('ESIC_EE', 'ESI_EE') then (c->>'amount')::numeric end), 0),
         coalesce(sum(case when c->>'kind' = 'employer'  and c->>'headCode' in ('ESIC_ER', 'ESI_ER') then (c->>'amount')::numeric end), 0)
    into v_pf_ee, v_pf_er, v_esi_ee, v_esi_er
    from public.payroll_desk_run_lines l, jsonb_array_elements(coalesce(l.components, '[]'::jsonb)) c
   where l.run_id = p_run_id and l.tenant_id = p_tenant_id;
  if v_pf_ee + v_pf_er = 0 and v_pf_govt > 0 then v_pf_er := v_pf_govt; end if;
  if v_esi_ee + v_esi_er = 0 and v_esi_govt > 0 then v_esi_er := v_esi_govt; end if;

  v_rest := v_total_ded - v_pf_ee - v_esi_ee - v_adv - v_special - v_lwp - v_late;
  if v_rest < 0 then
    v_lwp := 0; v_late := 0;
    v_rest := v_total_ded - v_pf_ee - v_esi_ee - v_adv - v_special;
  end if;
  if v_rest < 0 or v_gross - v_total_ded <> v_net then
    return jsonb_build_object('ok', false, 'refused',
      format('run %s: gross %s, deductions %s and net %s do not agree', v_run.month, v_gross, v_total_ded, v_net));
  end if;

  v_lines := jsonb_build_array(jsonb_build_object(
    'account_code', '5070', 'debit_paise', round((v_gross - v_lwp - v_late) * 100), 'credit_paise', 0,
    'narration', 'Salary & wages ' || v_run.month, 'cost_centre_code', 'school'));
  if v_pf_er + v_esi_er > 0 then v_lines := v_lines || jsonb_build_object(
    'account_code', '5070', 'debit_paise', round((v_pf_er + v_esi_er) * 100), 'credit_paise', 0,
    'narration', 'Employer PF & ESI ' || v_run.month, 'cost_centre_code', 'school'); end if;
  if v_adv > 0 then v_lines := v_lines || jsonb_build_object(
    'account_code', '1070', 'debit_paise', 0, 'credit_paise', round(v_adv * 100),
    'narration', 'Advances recovered'); end if;
  if v_pf_ee + v_pf_er > 0 then v_lines := v_lines || jsonb_build_object(
    'account_code', '2320', 'debit_paise', 0, 'credit_paise', round((v_pf_ee + v_pf_er) * 100),
    'narration', 'PF payable — employee ' || v_pf_ee || ' + employer ' || v_pf_er); end if;
  if v_esi_ee + v_esi_er > 0 then v_lines := v_lines || jsonb_build_object(
    'account_code', '2330', 'debit_paise', 0, 'credit_paise', round((v_esi_ee + v_esi_er) * 100),
    'narration', 'ESI payable — employee ' || v_esi_ee || ' + employer ' || v_esi_er); end if;
  if v_special + v_rest > 0 then v_lines := v_lines || jsonb_build_object(
    'account_code', '2300', 'debit_paise', 0, 'credit_paise', round((v_special + v_rest) * 100),
    'narration', 'Other deductions withheld'); end if;
  v_lines := v_lines || jsonb_build_object(
    'account_code', '2110', 'debit_paise', 0, 'credit_paise', round(v_net * 100),
    'narration', 'Net payable ' || v_run.month);

  -- The accrual. One live voucher per run: source id = run id, and after a
  -- recall the next version (run id #2, #3 …). ledger_post is idempotent on
  -- the source id and hands back a voucher even when it was reversed, so the
  -- live one is looked up here first (payroll_ledger_slot).
  select * into v_slot from public.payroll_ledger_slot(p_tenant_id, 'payroll_run', p_run_id, p_run_id, coalesce(v_run.lock_version, 0));
  if v_slot.live_id is not null then
    v_accrual := jsonb_build_object('voucher_no', v_slot.live_no, 'created', false);
  elsif not v_slot.may_post then
    return jsonb_build_object('ok', true, 'month', v_run.month,
      'accrual', jsonb_build_object('voucher_no', null, 'skipped', v_slot.why), 'payment', null);
  else
    v_src := case when v_slot.versions = 0 then p_run_id else p_run_id || '#' || (v_slot.versions + 1) end;
    v_res := public.ledger_post(p_tenant_id, jsonb_build_object(
      'voucher_type', 'payroll', 'date', v_month_end,
      'narration', 'Payroll ' || v_run.month || ' — ' || n_lines || ' staff',
      'source_type', 'payroll_run', 'source_id', v_src,
      'created_by', v_created_by, 'lines', v_lines));
    if not coalesce((v_res->>'ok')::boolean, false) then
      raise exception 'The books refused payroll %: %', v_run.month, coalesce(v_res->>'error', 'unknown ledger error');
    end if;
    v_accrual := jsonb_build_object('voucher_no', v_res->>'voucher_no', 'created', coalesce((v_res->>'created')::boolean, false));
  end if;

  -- The payment leg (14 Oct 2026). Staff are paid on different days, by
  -- different means: one payment voucher per (day paid, money account), from
  -- the lines marked paid. Source id run ':pay:' date ':' account (cash,
  -- wallet, the bank account id, or 1010), versioned like the accrual. A
  -- group whose lines changed (a line marked paid later on the same day, or
  -- un-marked) is reversed and re-posted at its new total; a group nobody is
  -- in any more is reversed. A run marked paid as a whole before this (no
  -- line carries a paid date) is paid on the run's paid date.
  v_payment := null;
  if v_reclassed > 0 then
    if v_status = 'paid' then
      v_payment := jsonb_build_object('skipped',
        'the salary payments for this month are already in the book as reclassified reconstruction');
    end if;
    return jsonb_build_object('ok', true, 'month', v_run.month, 'accrual', v_accrual, 'payment', v_payment);
  end if;

  -- Paid the old way (one payment voucher keyed by the run id), or corrected
  -- by hand (payroll_payment_correction / payroll_correction, e.g. the April
  -- runs): the book already holds its payment and is left alone.
  select count(*),
         string_agg(v.voucher_no, ', ' order by v.voucher_no) filter (
           where not exists (select 1 from public.ledger_vouchers r
                              where r.tenant_id = p_tenant_id and r.reverses_voucher_id = v.id))
    into v_legacy_n, v_legacy
    from public.ledger_vouchers v
   where v.tenant_id = p_tenant_id
     and (v.source_type in ('payroll_payment', 'payroll_payment_correction')
          or (v.source_type = 'payroll_correction' and v.voucher_type = 'payment'))
     and (v.source_id = p_run_id
          or left(v.source_id, length(p_run_id) + 1) in (p_run_id || '#', p_run_id || ':'))
     and position(':pay:' in v.source_id) = 0;
  if v_legacy_n > 0 then
    v_payment := case when v_legacy is null
      then jsonb_build_object('skipped', 'this run''s payment was reversed in the book by hand — not re-posted')
      else jsonb_build_object('voucher_no', v_legacy, 'created', false) end;
    return jsonb_build_object('ok', true, 'month', v_run.month, 'accrual', v_accrual, 'payment', v_payment);
  end if;

  if not exists (select 1 from public.payroll_desk_run_lines
                  where run_id = p_run_id and tenant_id = p_tenant_id and paid_on is not null)
     and v_status = 'paid' and v_run.paid_at is not null then
    v_default_paid := (v_run.paid_at at time zone 'Asia/Kolkata')::date;
  end if;

  for m in
    select g.d, g.kind, g.bank_id, sum(g.amt) as amt, count(*) as n,
           string_agg(distinct g.mode, ', ' order by g.mode) as modes,
           string_agg(nullif(g.ref, ''), ', ' order by g.ref) as refs,
           max(nullif(g.paid_by, '')) as paid_by
      from (
        select x.d, x.amt, x.mode, x.ref, x.paid_by, x.kind,
               case when x.kind = 'bank' then coalesce(
                 (select b.bank_id from public.accounts_desk_mode_bank_map b
                   where b.tenant_id = p_tenant_id and b.mode = x.mode),
                 (select b.bank_id from public.accounts_desk_mode_bank_map b
                   where b.tenant_id = p_tenant_id and b.mode in ('neft', 'upi', 'rtgs') order by b.mode limit 1))
               end as bank_id
          from (
            select coalesce(l.paid_on, v_default_paid) as d,
                   coalesce(l.amount_payable, l.net_pay) as amt,
                   lower(coalesce(nullif(l.payment_mode, ''), 'bank_transfer')) as mode,
                   coalesce(l.payment_ref, '') as ref,
                   coalesce(l.paid_by, '') as paid_by,
                   -- Wallet-paid lines left the Payouts wallet, not a bank.
                   case when public.payroll_line_wallet_paid(p_tenant_id, p_run_id, l.staff_id) then 'wallet'
                        when lower(coalesce(l.payment_mode, '')) = 'cash' then 'cash'
                        else 'bank' end as kind
              from public.payroll_desk_run_lines l
             where l.run_id = p_run_id and l.tenant_id = p_tenant_id
          ) x
         where x.d is not null and x.amt > 0
      ) g
     group by g.d, g.kind, g.bank_id
     order by g.d, g.kind, g.bank_id
  loop
    if m.kind = 'wallet' then
      v_code := '1110'; v_bank := ''; v_key := 'wallet';
    elsif m.kind = 'cash' then
      v_code := '1000'; v_bank := ''; v_key := 'cash';
    else
      v_bank := coalesce(m.bank_id, '');
      v_code := case when v_bank = '' then '1010'
                     else public.accounts_ledger_money_account(p_tenant_id, v_bank, '') end;
      v_key := case when v_bank = '' then '1010' else v_bank end;
    end if;
    v_base := p_run_id || ':pay:' || to_char(m.d, 'YYYY-MM-DD') || ':' || v_key;
    v_bases := v_bases || v_base;
    v_paise := round(m.amt * 100);

    select * into v_slot from public.payroll_ledger_slot(p_tenant_id, 'payroll_payment', v_base, p_run_id, coalesce(v_run.lock_version, 0));
    if v_slot.live_id is not null and v_slot.live_paise = v_paise then
      v_payments := v_payments || jsonb_build_object('date', m.d, 'account', v_code, 'staff', m.n,
        'amount_paise', v_paise, 'voucher_no', v_slot.live_no, 'created', false);
      continue;
    end if;
    if v_slot.live_id is not null then
      v_res := public.ledger_reverse(p_tenant_id, v_slot.live_id,
        'Salary payments regrouped: ' || v_run.month || ' paid on ' || to_char(m.d, 'YYYY-MM-DD') || ' is now ' || m.n || ' staff',
        null, coalesce(nullif(m.paid_by, ''), v_created_by));
      if not coalesce((v_res->>'ok')::boolean, false) then
        raise exception 'The books refused to regroup the salary paid on % for %: %', m.d, v_run.month, coalesce(v_res->>'error', 'unknown ledger error');
      end if;
    elsif not v_slot.may_post then
      v_payments := v_payments || jsonb_build_object('date', m.d, 'account', v_code, 'staff', m.n,
        'amount_paise', v_paise, 'voucher_no', null, 'skipped', v_slot.why);
      continue;
    end if;

    v_src := case when v_slot.versions = 0 then v_base else v_base || '#' || (v_slot.versions + 1) end;
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', '2110', 'debit_paise', v_paise, 'credit_paise', 0,
        'narration', 'Net payable ' || v_run.month || ' — ' || m.n || ' staff'),
      jsonb_build_object(
        'account_code', v_code, 'debit_paise', 0, 'credit_paise', v_paise,
        'narration', case when m.kind = 'wallet' then 'Salary paid from the Cashfree Payouts wallet'
                          else 'Salary disbursed by ' || m.modes end
                     || coalesce(' · ref ' || left(m.refs, 200), ''),
        'subledger_kind', case when v_code not in ('1000', '1010', '1110') and v_bank <> '' then 'bank_account' else '' end,
        'subledger_id', case when v_code not in ('1000', '1010', '1110') then v_bank else '' end));
    v_res := public.ledger_post(p_tenant_id, jsonb_build_object(
      'voucher_type', 'payment', 'date', m.d,
      'narration', 'Salary paid ' || v_run.month || ' — ' || m.n || ' staff on ' || to_char(m.d, 'YYYY-MM-DD'),
      'source_type', 'payroll_payment', 'source_id', v_src,
      'created_by', coalesce(nullif(m.paid_by, ''), nullif(v_run.paid_by, ''), v_created_by), 'lines', v_lines));
    if not coalesce((v_res->>'ok')::boolean, false) then
      raise exception 'The books refused the salary paid on % for %: %', m.d, v_run.month, coalesce(v_res->>'error', 'unknown ledger error');
    end if;
    v_payments := v_payments || jsonb_build_object('date', m.d, 'account', v_code, 'staff', m.n,
      'amount_paise', v_paise, 'voucher_no', v_res->>'voucher_no', 'created', coalesce((v_res->>'created')::boolean, false));
  end loop;

  -- A group no line is in any more (un-marked, or moved to another day or
  -- account): its live voucher is reversed.
  for v_stale in
    select v.id, v.voucher_no, public.payroll_source_base(v.source_id) as base
      from public.ledger_vouchers v
     where v.tenant_id = p_tenant_id and v.source_type = 'payroll_payment'
       and left(v.source_id, length(p_run_id) + 5) = p_run_id || ':pay:'
       and not exists (select 1 from public.ledger_vouchers r where r.tenant_id = p_tenant_id and r.reverses_voucher_id = v.id)
       and not (public.payroll_source_base(v.source_id) = any (v_bases))
  loop
    v_res := public.ledger_reverse(p_tenant_id, v_stale.id,
      'Salary payments regrouped: ' || v_run.month || ' — nobody is marked paid in this group any more',
      null, v_created_by);
    if not coalesce((v_res->>'ok')::boolean, false) then
      raise exception 'The books refused to reverse % for %: %', v_stale.voucher_no, v_run.month, coalesce(v_res->>'error', 'unknown ledger error');
    end if;
    v_payments := v_payments || jsonb_build_object('voucher_no', v_stale.voucher_no, 'reversed_by', v_res->>'voucher_no');
  end loop;

  if jsonb_array_length(v_payments) > 0 then
    select jsonb_build_object(
             'voucher_no', string_agg(p->>'voucher_no', ', ' order by p->>'voucher_no') filter (where p->>'voucher_no' is not null and p->>'reversed_by' is null),
             'created', coalesce(bool_or((p->>'created')::boolean), false),
             'groups', v_payments)
      into v_payment
      from jsonb_array_elements(v_payments) p;
  end if;

  return jsonb_build_object('ok', true, 'month', v_run.month, 'accrual', v_accrual, 'payment', v_payment);
end;
$function$;


-- Recall a run to draft in the book: reverse its live accrual and payment
-- vouchers and record the recall, all or nothing. A paid run is never
-- recalled (director's rule); a run with hand corrections is recalled in
-- Accounts by hand.
create or replace function public.payroll_ledger_recall(
  p_tenant_id uuid, p_run_id text, p_actor text default 'system', p_reason text default ''
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_run record; v_vch record; v_res jsonb; v_out jsonb := '[]'::jsonb; v_reason text; v_fixes text;
begin
  select * into v_run from public.payroll_desk_runs
   where id = p_run_id and tenant_id = p_tenant_id
   for update;
  if not found then return jsonb_build_object('ok', false, 'refused', 'no such payroll run'); end if;
  if lower(coalesce(v_run.status, '')) = 'paid' then
    return jsonb_build_object('ok', false, 'refused',
      'this salary is already marked paid, so it cannot go back to draft');
  end if;

  select string_agg(v.voucher_no, ', ' order by v.voucher_no) into v_fixes
    from public.ledger_vouchers v
   where v.tenant_id = p_tenant_id
     and v.source_type in ('payroll_payment_correction', 'payroll_correction')
     and public.payroll_source_run_id(v.source_id) = p_run_id
     and not exists (select 1 from public.ledger_vouchers r
                      where r.tenant_id = p_tenant_id and r.reverses_voucher_id = v.id);
  if v_fixes is not null then
    return jsonb_build_object('ok', false, 'refused',
      'the book holds hand corrections for this run (' || v_fixes || ') — reverse them in Accounts first');
  end if;

  v_reason := coalesce(nullif(trim(p_reason), ''),
    'Payroll ' || coalesce(v_run.month, '') || ' recalled to draft by ' || coalesce(nullif(p_actor, ''), 'system'));

  -- Payments first, then the accrual they settle.
  for v_vch in
    select x.id, x.voucher_no, x.source_type, x.source_id
      from public.ledger_vouchers x
     where x.tenant_id = p_tenant_id
       and x.source_type in ('payroll_payment', 'payroll_run')
       and (x.source_id = p_run_id
            or left(x.source_id, length(p_run_id) + 1) in (p_run_id || '#', p_run_id || ':'))
       and not exists (select 1 from public.ledger_vouchers r
                        where r.tenant_id = p_tenant_id and r.reverses_voucher_id = x.id)
     order by case x.source_type when 'payroll_payment' then 0 else 1 end, x.voucher_no
  loop
    v_res := public.ledger_reverse(p_tenant_id, v_vch.id, v_reason, null, coalesce(nullif(p_actor, ''), 'system'));
    if not coalesce((v_res->>'ok')::boolean, false) then
      raise exception 'The book refused to reverse % (payroll %): %', v_vch.voucher_no, v_run.month,
        coalesce(v_res->>'error', 'unknown ledger error');
    end if;
    v_out := v_out || jsonb_build_object('voucher_no', v_vch.voucher_no, 'source_type', v_vch.source_type,
      'reversal_no', v_res->>'voucher_no');
  end loop;

  insert into public.payroll_ledger_recalls (tenant_id, run_id, month, lock_version, actor, reason, reversed)
  values (p_tenant_id, p_run_id, coalesce(v_run.month, ''), coalesce(v_run.lock_version, 0),
          coalesce(p_actor, ''), v_reason, v_out);

  return jsonb_build_object('ok', true, 'month', v_run.month, 'reversed', v_out);
end;
$function$;
revoke all on function public.payroll_ledger_recall(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.payroll_ledger_recall(uuid, text, text, text) to service_role;

-- Runs already back in draft whose accrual was reversed by hand (July 2026:
-- PR/FY2026-27/00002 reversed as RV/FY2026-27/00983 on 14 Oct) count as
-- recalled, so they post afresh when next posted. Paid or posted runs whose
-- vouchers were reversed by hand (September: pr_709wtqcn) are not touched.
insert into public.payroll_ledger_recalls (tenant_id, run_id, month, lock_version, actor, reason, reversed)
select r.tenant_id, r.id, coalesce(r.month, ''), coalesce(r.lock_version, 0), 'migration',
       'accrual reversed by hand while the run was back in draft (20261014120000)',
       coalesce((select jsonb_agg(jsonb_build_object('voucher_no', v.voucher_no, 'source_type', v.source_type,
                                                     'reversal_no', rv.voucher_no))
                   from public.ledger_vouchers v
                   join public.ledger_vouchers rv on rv.tenant_id = v.tenant_id and rv.reverses_voucher_id = v.id
                  where v.tenant_id = r.tenant_id and v.source_type in ('payroll_run', 'payroll_payment')
                    and public.payroll_source_run_id(v.source_id) = r.id), '[]'::jsonb)
  from public.payroll_desk_runs r
 where lower(coalesce(r.status, '')) not in ('posted', 'paid')
   and exists (select 1 from public.ledger_vouchers v
                where v.tenant_id = r.tenant_id and v.source_type = 'payroll_run'
                  and public.payroll_source_run_id(v.source_id) = r.id)
   and not exists (select 1 from public.ledger_vouchers v
                    where v.tenant_id = r.tenant_id and v.source_type = 'payroll_run'
                      and public.payroll_source_run_id(v.source_id) = r.id
                      and not exists (select 1 from public.ledger_vouchers x
                                       where x.tenant_id = r.tenant_id and x.reverses_voucher_id = v.id))
   and not exists (select 1 from public.payroll_ledger_recalls c
                    where c.tenant_id = r.tenant_id and c.run_id = r.id);

notify pgrst, 'reload schema';
