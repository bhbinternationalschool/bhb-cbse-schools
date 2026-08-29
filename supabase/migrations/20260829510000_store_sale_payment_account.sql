-- Sale-creation payments record which account received them.
--
-- Companion to 20260829500000 (the column) and the collect-RPC change: a sale
-- paid at the counter goes through inv_post_sale_core, which was writing mode
-- and reference but not the destination account.
--
-- Patched by targeted replacement rather than re-declared in full: the
-- function is ~7.6 KB and restating it here would fork two copies of logic
-- that has nothing to do with this change. On a fresh database the earlier
-- migration creates the original text first, so the replacement matches. If
-- it ever stops matching the migration RAISES instead of silently doing
-- nothing — a no-op here would mean store money quietly losing its account
-- again, which is exactly the failure this is fixing.

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'inv_post_sale_core';

  if v_def is null then
    raise exception 'inv_post_sale_core not found';
  end if;

  if v_def like '%bank_account_id%' then
    return; -- already applied
  end if;

  v_def := replace(v_def,
    'insert into public.inv_sale_payments (
      tenant_id, sale_id, paid_on, amount_paise, mode, reference, created_by
    ) values (
      p_tenant_id, v_sale_id, v_sale_date,
      (v_pay->>''amount_paise'')::bigint,
      coalesce(v_pay->>''mode'', ''cash''),
      coalesce(v_pay->>''reference'', ''''), p_actor
    );',
    'insert into public.inv_sale_payments (
      tenant_id, sale_id, paid_on, amount_paise, mode, reference,
      bank_account_id, created_by
    ) values (
      p_tenant_id, v_sale_id, v_sale_date,
      (v_pay->>''amount_paise'')::bigint,
      coalesce(v_pay->>''mode'', ''cash''),
      coalesce(v_pay->>''reference'', ''''),
      coalesce(v_pay->>''bank_account_id'', ''''), p_actor
    );');

  if v_def not like '%bank_account_id%' then
    raise exception
      'inv_post_sale_core payment insert did not match — store sale payments would lose their bank account';
  end if;

  execute v_def;
end $$;

notify pgrst, 'reload schema';
