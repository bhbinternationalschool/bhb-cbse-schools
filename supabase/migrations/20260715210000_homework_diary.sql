-- Homework & class diary (§19a)

create table if not exists public.homework_posts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  academic_year_code text not null,
  class_id text not null,
  section_id text not null,
  subject_id text not null,
  teacher_staff_id text,
  teacher_name text,
  post_date date not null,
  title text not null,
  body_en text,
  body_hi text,
  due_at date,
  requires_submit boolean not null default false,
  ai_tutor_hint text,
  status text not null default 'published',
  created_at timestamptz not null default now()
);

create table if not exists public.homework_attachments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.homework_posts(id) on delete cascade,
  label text,
  url text not null
);

create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  academic_year_code text not null,
  class_id text not null,
  section_id text not null,
  teacher_staff_id text,
  teacher_name text,
  entry_date date not null,
  title text not null,
  body_en text,
  body_hi text,
  created_at timestamptz not null default now()
);

create table if not exists public.homework_submissions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.homework_posts(id) on delete cascade,
  student_id text not null,
  note text,
  photo_url text,
  submitted_at timestamptz not null default now(),
  teacher_ack_at timestamptz,
  teacher_ack_by text
);

create table if not exists public.homework_seen (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  ref_id text not null,
  student_id text not null,
  household_id text,
  seen_at timestamptz not null default now()
);

create index if not exists homework_posts_section_date_idx
  on public.homework_posts (section_id, post_date);
create index if not exists homework_seen_ref_idx
  on public.homework_seen (kind, ref_id, student_id);

comment on table public.homework_posts is
  'Teacher homework posts by class-section-subject (§19a). Client localStorage until wired.';
