-- Week 11–13: private object storage for staff docs / student photos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'school-files',
  'school-files',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'image/gif'
  ]
)
on conflict (id) do nothing;

-- Tenant members can read/write objects under their tenant folder prefix
-- Paths: {tenant_id}/... or legacy staff/... students/...
drop policy if exists "school_files_tenant_select" on storage.objects;
create policy "school_files_tenant_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'school-files'
    and (
      (storage.foldername(name))[1] in (
        select t.id::text from public.tenants t
        join public.profiles p on p.tenant_id = t.id
        where p.auth_user_id = auth.uid()
      )
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
      (storage.foldername(name))[1] in (
        select t.id::text from public.tenants t
        join public.profiles p on p.tenant_id = t.id
        where p.auth_user_id = auth.uid()
      )
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
      (storage.foldername(name))[1] in (
        select t.id::text from public.tenants t
        join public.profiles p on p.tenant_id = t.id
        where p.auth_user_id = auth.uid()
      )
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
      (storage.foldername(name))[1] in (
        select t.id::text from public.tenants t
        join public.profiles p on p.tenant_id = t.id
        where p.auth_user_id = auth.uid()
      )
      or (storage.foldername(name))[1] in ('staff', 'students', 'docs', 'shared')
    )
  );
