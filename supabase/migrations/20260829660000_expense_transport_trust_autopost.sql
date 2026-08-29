-- Post automatically, on the same terms as fees: never raise, always
-- idempotent. These tables are written by the desk mirror, so a trigger is
-- the only hook that catches every writer — and a bookkeeping failure must
-- never cost the school the underlying record.

create or replace function public.accounts_desk_ledger_autopost()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  begin
    if tg_table_name = 'accounts_desk_expense_vouchers' then
      perform public.expense_voucher_ledger_post(new.tenant_id, new.id, 'desk');
    elsif tg_table_name = 'accounts_desk_expense_voucher_lines' then
      perform public.expense_voucher_ledger_post(new.tenant_id, new.voucher_id, 'desk');
    elsif tg_table_name = 'transport_payables' then
      perform public.transport_payable_ledger_post(new.tenant_id, new.id, 'desk');
    elsif tg_table_name = 'accounts_desk_owner_loans' then
      perform public.owner_loan_ledger_post(new.tenant_id, new.id, 'desk');
    elsif tg_table_name = 'accounts_desk_owner_loan_schedule' then
      perform public.owner_loan_installment_ledger_post(new.tenant_id, new.id, 'desk');
    end if;
  exception when others then
    -- Swallowed on purpose. ledger_coverage() surfaces anything that did not
    -- post, which is recoverable; a lost expense or loan record is not.
    null;
  end;
  return new;
end;
$function$;

drop trigger if exists expense_vouchers_ledger_autopost on public.accounts_desk_expense_vouchers;
create trigger expense_vouchers_ledger_autopost
  after insert or update on public.accounts_desk_expense_vouchers
  for each row execute function public.accounts_desk_ledger_autopost();

drop trigger if exists expense_voucher_lines_ledger_autopost on public.accounts_desk_expense_voucher_lines;
create trigger expense_voucher_lines_ledger_autopost
  after insert or update on public.accounts_desk_expense_voucher_lines
  for each row execute function public.accounts_desk_ledger_autopost();

drop trigger if exists transport_payables_ledger_autopost on public.transport_payables;
create trigger transport_payables_ledger_autopost
  after insert or update on public.transport_payables
  for each row execute function public.accounts_desk_ledger_autopost();

drop trigger if exists owner_loans_ledger_autopost on public.accounts_desk_owner_loans;
create trigger owner_loans_ledger_autopost
  after insert or update on public.accounts_desk_owner_loans
  for each row execute function public.accounts_desk_ledger_autopost();

drop trigger if exists owner_loan_schedule_ledger_autopost on public.accounts_desk_owner_loan_schedule;
create trigger owner_loan_schedule_ledger_autopost
  after insert or update on public.accounts_desk_owner_loan_schedule
  for each row execute function public.accounts_desk_ledger_autopost();

notify pgrst, 'reload schema';
