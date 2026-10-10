-- Teaching-job applications: a CV arrives from the public careers page or
-- from a WhatsApp job enquiry, is read by OCR, and waits here for the
-- principal and the office.
--
-- Rows, not a state blob. Applications are append-mostly, they are read
-- one at a time, and they outlive whoever was logged in when they landed;
-- a whole-module JSON blob rewritten on every submission would make two
-- applicants arriving in the same minute a lost-update problem.
--
-- What is NOT here is deliberate. A CV shows date of birth, photograph,
-- caste, marital status and address; none of that is extracted and none
-- of it is stored. The columns below are what a school needs to decide
-- whether to call somebody: who they are, how to reach them, what they
-- teach, and where the file is.

create table if not exists public.job_applications (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null default 'careers_page'
    check (source in ('careers_page', 'whatsapp', 'office')),
  applicant_name text not null default '',
  mobile text not null default '',
  email text not null default '',
  -- Private storage path in the school-files bucket. Never a public URL.
  cv_path text not null default '',
  cv_mime text not null default '',
  -- The applicant's own words, kept beside the resolved ids so the office
  -- can see what the CV said when the mapping finds nothing.
  subject_words text[] not null default '{}',
  class_words text[] not null default '{}',
  subject_ids text[] not null default '{}',
  class_ids text[] not null default '{}',
  qualification text not null default '',
  experience_years text not null default '',
  current_employer text not null default '',
  ocr_status text not null default 'pending'
    check (ocr_status in ('pending', 'ok', 'unreadable', 'failed')),
  ocr_notes text not null default '',
  status text not null default 'new'
    check (status in ('new', 'shortlisted', 'interviewed', 'rejected', 'hired')),
  created_at timestamptz not null default now(),
  reviewed_by text not null default '',
  reviewed_at timestamptz
);

-- The inbox query: newest first, within a tenant.
create index if not exists job_applications_inbox_idx
  on public.job_applications (tenant_id, created_at desc);

-- "Has this person already applied?" — asked on every submission, so the
-- careers page cannot be used to file the same CV a hundred times.
create index if not exists job_applications_mobile_idx
  on public.job_applications (tenant_id, mobile, created_at desc);

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 and the request "succeeds" while storing nothing.
grant all on public.job_applications to service_role;

notify pgrst, 'reload schema';
