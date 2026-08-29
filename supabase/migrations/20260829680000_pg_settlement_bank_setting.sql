-- Where the gateway settles.
--
-- resolveBank() matches the gateway's settlement account by its last four
-- digits and fell back to the 1010 group when that was absent or ambiguous —
-- correct, because guessing a bank is worse than admitting you do not know.
--
-- But for this school the answer IS known: Cashfree settles to UBI-Main and
-- nowhere else, confirmed by the Director. Recording that turns the fallback
-- from "we cannot tell" into "we were told", so a settlement whose payload
-- omits the account number lands in the right bank instead of the group.
--
-- The order in resolveBank stays: what the gateway tells us beats what we
-- were told, because a payload naming an account is evidence and a setting is
-- only a standing instruction. A standing instruction still beats the group.
--
-- A setting rather than a constant: the day a second settlement account is
-- opened, this is where it changes.

alter table public.accounts_desk_settings
  add column if not exists pg_settlement_bank_account_id text not null default '';

comment on column public.accounts_desk_settings.pg_settlement_bank_account_id is
  'Bank the payment gateway settles into when its payload does not identify one. Empty means fall back to the 1010 group.';

insert into public.accounts_desk_settings (tenant_id, pg_settlement_bank_account_id)
select b.tenant_id, b.id
from public.accounts_desk_bank_accounts b
where b.id = 'bnk_5rx0puwl'
on conflict (tenant_id) do update
  set pg_settlement_bank_account_id = excluded.pg_settlement_bank_account_id,
      updated_at = now()
  where public.accounts_desk_settings.pg_settlement_bank_account_id = '';

notify pgrst, 'reload schema';
