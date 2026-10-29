/*
 * Allow the Social Media Manager to raise office tasks (director, 29 Oct 2026).
 * The Social Media Manager (automation/n8n, "Office — Social Media Manager")
 * raises post drafts as office_tasks with source = 'social'. Widen the
 * office_tasks.source check to include it. Idempotent; guarded on the table's
 * presence so it is safe on a database that does not yet have office_tasks.
 */
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'office_tasks'
  ) then
    alter table public.office_tasks drop constraint if exists office_tasks_source_check;
    alter table public.office_tasks add constraint office_tasks_source_check
      check (source in ('huddle', 'receptionist', 'academic', 'director', 'marketing', 'assistant', 'transport', 'social'));
  end if;
end
$$;

notify pgrst, 'reload schema';
