/*
 * Allow the 'changes' approval state (director, 29 Oct 2026). When the director
 * or an assignee sends an approval back for modification on Telegram, the task
 * is marked approval_state = 'changes' (status reopened). Widen the
 * office_tasks.approval_state check to include it. Idempotent; guarded.
 */
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'office_tasks'
  ) then
    alter table public.office_tasks drop constraint if exists office_tasks_approval_state_check;
    alter table public.office_tasks add constraint office_tasks_approval_state_check
      check (approval_state in ('none', 'pending', 'approved', 'rejected', 'changes'));
  end if;
end
$$;

notify pgrst, 'reload schema';
