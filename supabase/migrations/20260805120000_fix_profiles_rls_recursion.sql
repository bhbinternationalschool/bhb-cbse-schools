-- Fix infinite recursion in profiles RLS.
-- Root cause: profiles policy subqueries profiles; any other policy that
-- reads profiles to resolve tenant_id re-enters profiles RLS indefinitely.
-- Pattern: SECURITY DEFINER helpers bypass RLS for the profiles lookup.

create or replace function public.auth_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id
  from public.profiles
  where auth_user_id = auth.uid()
  order by created_at
  limit 1;
$$;

create or replace function public.is_tenant_member(check_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where auth_user_id = auth.uid()
      and tenant_id = check_tenant_id
  );
$$;

revoke all on function public.auth_tenant_id() from public;
grant execute on function public.auth_tenant_id() to authenticated, service_role;

revoke all on function public.is_tenant_member(uuid) from public;
grant execute on function public.is_tenant_member(uuid) to authenticated, service_role;

-- profiles: was self-referential (profiles → profiles)
drop policy if exists "profiles own tenant" on public.profiles;
create policy "profiles own tenant"
  on public.profiles for all
  to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- All existing *_tenant_all policies that subquery profiles
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and policyname like '%\_tenant_all' escape '\'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      r.policyname, r.schemaname, r.tablename
    );
    execute format(
      $p$
      create policy %I on %I.%I for all to authenticated
      using (public.is_tenant_member(tenant_id))
      with check (public.is_tenant_member(tenant_id))
      $p$,
      r.policyname, r.schemaname, r.tablename
    );
  end loop;
end $$;

-- Storage policies also joined profiles (same recursion path)
drop policy if exists "school_files_tenant_select" on storage.objects;
create policy "school_files_tenant_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'school-files'
    and (
      (storage.foldername(name))[1] = public.auth_tenant_id()::text
      or (storage.foldername(name))[1] in ('staff', 'students', 'docs', 'shared')
    )
  );

drop policy if exists "school_files_tenant_insert" on storage.objects;
create policy "school_files_tenant_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'school-files'
    and (
      (storage.foldername(name))[1] = public.auth_tenant_id()::text
      or (storage.foldername(name))[1] in ('staff', 'students', 'docs', 'shared')
    )
  );

drop policy if exists "school_files_tenant_update" on storage.objects;
create policy "school_files_tenant_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'school-files'
    and (
      (storage.foldername(name))[1] = public.auth_tenant_id()::text
      or (storage.foldername(name))[1] in ('staff', 'students', 'docs', 'shared')
    )
  );

drop policy if exists "school_files_tenant_delete" on storage.objects;
create policy "school_files_tenant_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'school-files'
    and (
      (storage.foldername(name))[1] = public.auth_tenant_id()::text
      or (storage.foldername(name))[1] in ('staff', 'students', 'docs', 'shared')
    )
  );

comment on function public.auth_tenant_id() is
  'Returns tenant_id for the current auth user. SECURITY DEFINER to avoid profiles RLS recursion.';
comment on function public.is_tenant_member(uuid) is
  'True when auth.uid() has a profile in the given tenant. SECURITY DEFINER to avoid profiles RLS recursion.';
