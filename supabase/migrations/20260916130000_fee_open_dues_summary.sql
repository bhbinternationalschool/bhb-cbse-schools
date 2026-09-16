-- What the school is owed, in one row.
--
-- WHY (2026-09-16): every reader of `fee_desk_open_dues` summed the rows in
-- Node, and PostgREST caps a reply at 1,000. The table holds 1,140 rows, so
-- a total built that way is short by whatever the last 140 rows carry — and
-- it gets worse as the year fills. Summing where the rows are cannot be
-- capped and sends one row instead of a thousand.
--
-- This is the number the WhatsApp reminders and the /pay/due links work
-- from, so a dashboard showing it is showing what the parent will be asked
-- for. `rebuilt_at` is how fresh that is.

create or replace function public.fee_open_dues_summary(
  p_tenant_id uuid,
  p_academic_year_code text default null
)
returns table(
  rows_count bigint,
  student_count bigint,
  family_count bigint,
  total_balance_paise bigint,
  rebuilt_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    count(*)::bigint,
    count(distinct student_id)::bigint,
    count(distinct household_id)::bigint,
    coalesce(sum(balance_paise), 0)::bigint,
    max(updated_at)
  from public.fee_desk_open_dues
  where tenant_id = p_tenant_id
    and balance_paise > 0
    and (p_academic_year_code is null or academic_year_code = p_academic_year_code);
$function$;

grant execute on function public.fee_open_dues_summary(uuid, text) to service_role;
