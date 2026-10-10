-- Store money lands in the bank it actually went to.
--
-- inv_ledger_tender_account(mode) mapped cash->1000, cheque->1050 and
-- EVERYTHING ELSE to 1010 "Bank Accounts" — one undifferentiated bucket. So
-- ~₹3.07 lakh of store UPI sat in a single line that could not be reconciled
-- against any statement, because the books never recorded which account
-- received it. The payment rows now carry bank_account_id; this teaches the
-- books to use it.
--
-- A ledger account per bank, as children of 1010. The trial balance is flat
-- (ledger_v_account_balance is per account, not a parent rollup), so adding
-- children cannot double-count the parent, and 1010 keeps its existing
-- history rather than being restated: the ledger is append-only and
-- corrections belong in reverse-and-repost, not in an UPDATE.

alter table public.ledger_accounts
  add column if not exists bank_account_id text not null default '';

comment on column public.ledger_accounts.bank_account_id is
  'Accounts-desk bank this ledger account represents. Empty for everything that is not a specific bank.';

create unique index if not exists ledger_accounts_bank_account_id_key
  on public.ledger_accounts (tenant_id, bank_account_id)
  where bank_account_id <> '';

-- One ledger account per configured bank, numbered from 1011 upwards, skipping
-- any code already in use. Idempotent: a bank already linked is left alone.
do $$
declare
  b record;
  v_code text;
  v_n int;
  v_parent record;
begin
  for b in
    select ba.* from public.accounts_desk_bank_accounts ba
    where ba.is_active
      and not exists (
        select 1 from public.ledger_accounts la
        where la.tenant_id = ba.tenant_id and la.bank_account_id = ba.id
      )
    order by ba.name
  loop
    select * into v_parent from public.ledger_accounts
     where tenant_id = b.tenant_id and code = '1010';

    v_n := 11;
    loop
      v_code := '10' || v_n::text;
      exit when not exists (
        select 1 from public.ledger_accounts
        where tenant_id = b.tenant_id and code = v_code
      );
      v_n := v_n + 1;
      if v_n > 98 then
        raise exception 'No free ledger code in the 10xx bank band';
      end if;
    end loop;

    insert into public.ledger_accounts (
      tenant_id, code, name, parent_code, kind, schedule_group,
      is_cash, is_bank, is_control, is_active, bank_account_id
    ) values (
      b.tenant_id, v_code,
      trim(both ' ' from coalesce(b.name, 'Bank') ||
        case when coalesce(b.bank_name,'') <> '' then ' · ' || b.bank_name else '' end ||
        case when coalesce(b.account_no,'') <> ''
             then ' ' || right(b.account_no, 4) else '' end),
      '1010',
      coalesce(v_parent.kind, 'asset'),
      coalesce(v_parent.schedule_group, ''),
      false, true, false, true, b.id
    );
  end loop;
end $$;

-- Mode + destination. The one-argument form stays for the callers that have no
-- account to offer (sale posting, returns, vendor bills) and keeps its old
-- behaviour, so nothing else changes meaning.
create or replace function public.inv_ledger_tender_account(
  p_mode text,
  p_bank_account_id text,
  p_tenant_id uuid
) returns text
language plpgsql
stable
as $function$
declare
  v_code text;
begin
  if lower(coalesce(p_mode, '')) = 'cash' then
    return '1000';
  end if;
  if lower(coalesce(p_mode, '')) in ('cheque', 'dd') then
    return '1050';
  end if;

  if coalesce(p_bank_account_id, '') <> '' then
    select code into v_code from public.ledger_accounts
     where tenant_id = p_tenant_id
       and bank_account_id = p_bank_account_id
       and is_active;
    if v_code is not null then
      return v_code;
    end if;
  end if;

  -- No account on the payment, or a bank with no ledger account yet: fall back
  -- to the group rather than refusing the posting. A receipt that cannot be
  -- filed precisely still has to be filed.
  return '1010';
end;
$function$;

notify pgrst, 'reload schema';
