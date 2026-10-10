-- In-class questions, photographed answers, and the after-class note.
--
-- During a live online class the teacher asks a question; every child in
-- the section gets it on the phone, writes the answer in their copy,
-- photographs it and sends it. The teacher sees the answers by name as
-- they arrive and marks each right or wrong. After the class the teacher
-- says in a line what was taught, and the ERP drafts a summary and a
-- homework suggestion the teacher can post to the diary in one tap.
--
-- Photos live in the private school-files bucket under
-- online-classes/<session>/<question>/<student>.<ext>; only the path is
-- stored. The verdict is always a person's — nothing here marks a
-- child's work on its own.

create table if not exists public.online_class_questions (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id text not null references public.online_class_sessions(id) on delete cascade,
  order_no int not null default 1,
  text text not null default '',
  asked_by text not null default '',
  asked_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists online_class_questions_session_idx
  on public.online_class_questions (tenant_id, session_id, order_no);

create table if not exists public.online_class_answers (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  question_id text not null references public.online_class_questions(id) on delete cascade,
  session_id text not null,
  student_id text not null,
  household_id text not null default '',
  photo_path text not null default '',
  photo_mime text not null default '',
  text text not null default '',
  submitted_at timestamptz not null default now(),
  verdict text not null default ''
    check (verdict in ('', 'right', 'wrong', 'partial')),
  verdict_by text not null default '',
  verdict_at timestamptz,
  unique (question_id, student_id)
);

create index if not exists online_class_answers_session_idx
  on public.online_class_answers (tenant_id, session_id);
create index if not exists online_class_answers_student_idx
  on public.online_class_answers (tenant_id, student_id, session_id);

create table if not exists public.online_class_summaries (
  session_id text primary key references public.online_class_sessions(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- The teacher's own line: what was taught. The model only expands it.
  taught_note text not null default '',
  topic text not null default '',
  summary_en text not null default '',
  homework_title text not null default '',
  homework_body text not null default '',
  homework_due text not null default '',
  generation_id text not null default '',
  generated_at timestamptz,
  homework_post_id text not null default '',
  homework_posted_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 and the request "succeeds" while storing nothing.
grant all on public.online_class_questions to service_role;
grant all on public.online_class_answers to service_role;
grant all on public.online_class_summaries to service_role;

notify pgrst, 'reload schema';
