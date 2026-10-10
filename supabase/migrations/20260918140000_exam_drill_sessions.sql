-- One child's revision drill for one paper.
--
-- WHY: the exam-eve message already opens the tutor on tomorrow's subject,
-- but the DRILL — ask, check, correct, ask again until it is right — was one
-- sentence of instruction to a chat model. A chat model given that loses
-- count, accepts a wrong answer as nearly right, drifts onto a chapter the
-- class has not reached, and stops when the child says "ok". Nobody sees any
-- of it happen.
--
-- So the loop lives on the server and its state lives here: what was asked,
-- how each answer was judged, how many in a row are right, and — the field
-- that matters most — how far the class has actually been taught, which the
-- child tells us because no record in this ERP knows it.

create table if not exists public.exam_drill_sessions (
  tenant_id uuid not null,
  id text not null,
  student_id text not null,
  -- The paper this drill is for. One drill per child per paper: a child who
  -- comes back an hour later continues rather than starting again.
  paper_date date not null,
  subject_label text not null default '',
  paper_label text not null default '',
  -- The number the answers arrive from, so an inbound reply finds its drill.
  mobile10 text not null default '',
  -- Chapters 1..scope are fair game. 0 until the child says how far the
  -- class has got; nothing is asked while it is 0.
  scope smallint not null default 0,
  phase text not null default 'need_scope'
    check (phase in ('need_scope', 'asking', 'done')),
  -- [{question, skill, chapterPosition, verdict}] in the order asked.
  asked jsonb not null default '[]'::jsonb,
  -- Consecutive right answers. Three ends the drill.
  streak smallint not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, student_id, paper_date)
);

-- An inbound answer arrives with nothing but a phone number, and has to find
-- the one drill still running on it.
create index if not exists exam_drill_sessions_open_idx
  on public.exam_drill_sessions (tenant_id, mobile10, updated_at desc)
  where phase <> 'done';

alter table public.exam_drill_sessions enable row level security;

grant all on public.exam_drill_sessions to service_role;
