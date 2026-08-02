-- Homework & class diary — normalized SoR (text ids aligned with SIS / masters)

create table if not exists public.homework_desk_posts (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  class_id text not null,
  section_id text not null,
  subject_id text not null default '',
  teacher_staff_id text not null default '',
  teacher_name text not null default '',
  post_date date not null,
  title text not null default '',
  body_en text not null default '',
  body_hi text not null default '',
  attachments_json jsonb not null default '[]'::jsonb,
  due_at text not null default '',
  requires_submit boolean not null default false,
  ai_tutor_hint text not null default '',
  status text not null default 'published'
    check (status in ('published', 'withdrawn')),
  created_at timestamptz not null default now(),
  whatsapp_notified_at text not null default '',
  whatsapp_notified_count int not null default 0,
  source text not null default 'erp'
    check (source in ('erp', 'google_classroom')),
  google_course_work_id text not null default '',
  google_course_id text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.homework_desk_diary (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  class_id text not null,
  section_id text not null,
  teacher_staff_id text not null default '',
  teacher_name text not null default '',
  diary_date date not null,
  title text not null default '',
  body_en text not null default '',
  body_hi text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.homework_desk_submissions (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_id text not null references public.homework_desk_posts(id) on delete cascade,
  student_id text not null,
  note text not null default '',
  photo_url text not null default '',
  submitted_at timestamptz not null default now(),
  teacher_ack_at text not null default '',
  teacher_ack_by text not null default '',
  unique (post_id, student_id)
);

create table if not exists public.homework_desk_seen (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('post', 'diary')),
  ref_id text not null,
  student_id text not null,
  household_id text not null default '',
  seen_at timestamptz not null default now(),
  unique (kind, ref_id, student_id)
);

create table if not exists public.homework_desk_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  exam_mode_freeze boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.homework_desk_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  post_count int not null default 0,
  diary_count int not null default 0,
  submission_count int not null default 0,
  seen_count int not null default 0,
  last_post_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists homework_desk_posts_section_date_idx
  on public.homework_desk_posts (tenant_id, section_id, post_date desc);

create index if not exists homework_desk_diary_section_date_idx
  on public.homework_desk_diary (tenant_id, section_id, diary_date desc);

create index if not exists homework_desk_submissions_student_idx
  on public.homework_desk_submissions (tenant_id, student_id);

comment on table public.homework_desk_posts is
  'Homework posts by class-section-subject — system of record';
