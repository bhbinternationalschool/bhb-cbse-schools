-- Student document vault (files in Storage; metadata on student + rows)

-- Per-file registry (Admissions + SIS share the same table later)
create table if not exists public.student_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  doc_key text not null
    check (doc_key in (
      'birthCert', 'photo', 'aadhaar', 'addressProof',
      'tc', 'casteCert', 'incomeCert'
    )),
  status text not null default 'missing'
    check (status in ('missing', 'received', 'verified')),
  file_name text,
  mime_type text,
  byte_size bigint,
  storage_path text,
  uploaded_at timestamptz,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, student_id, doc_key)
);

create index if not exists student_documents_student_idx
  on public.student_documents (student_id);

create index if not exists student_documents_tenant_status_idx
  on public.student_documents (tenant_id, status);

comment on table public.student_documents is
  'SIS/Admissions document vault metadata; blobs in Storage bucket student-docs';

comment on column public.student_documents.storage_path is
  'Supabase Storage path: {tenant}/{student_id}/{doc_key}/{filename}';

-- Checklist JSON remains on students.docs for quick reads; prefer this table for files.
alter table public.students
  add column if not exists docs jsonb not null default '{}'::jsonb;

-- Storage bucket (run with service role / dashboard if storage schema exists)
-- insert into storage.buckets (id, name, public)
-- values ('student-docs', 'student-docs', false)
-- on conflict (id) do nothing;
