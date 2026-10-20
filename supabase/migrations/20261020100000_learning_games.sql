-- Learning games (director, 15 Oct 2026): practice quizzes from the school's
-- own syllabus, a few brain games, and teacher-launched competitions between
-- sections — with stars for learning and limits the SERVER enforces.
--
-- Rows, not a state blob: a competition is launched by one teacher and
-- played by sixty phones at once; each answer is its own insert.
--
-- What a phone is never trusted with:
--   * the answers — a session's items (with the right option) live in
--     game_sessions.items and only the prompt and options are sent;
--   * the score — correct counts and stars are computed here from
--     game_answers, one row per (session, question), so a question can be
--     answered once and a client's "I got 10/10" is ignored;
--   * the clock — every session has a server deadline (the game's length,
--     cut to what is left of the child's daily allowance and of the evening).

-- ── Settings: one row per school ─────────────────────────────────────────
create table if not exists public.game_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default true,
  -- Daily allowance per child for practice (competitions are not refused by
  -- it, but their minutes count towards the day's total).
  daily_minutes int not null default 30 check (daily_minutes between 1 and 240),
  -- Wall-clock IST. No play before play_from or from play_until on —
  -- competitions included. '24:00' = no evening cut-off.
  play_from text not null default '06:00',
  play_until text not null default '21:00',
  -- School hours: practice is refused inside them on school days; a
  -- teacher-launched competition is not.
  school_start text not null default '08:00',
  school_end text not null default '14:30',
  -- 0 = Sunday … 6 = Saturday.
  school_days int[] not null default '{1,2,3,4,5,6}',
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

-- ── Question pool ────────────────────────────────────────────────────────
-- One multiple-choice item for a grade (Nursery -2, LKG -1, UKG 0, Class N
-- = N) and subject, optionally pinned to a chapter of the school's own book
-- (school_textbooks / school_textbook_chapters).
--
-- source: 'publisher_key' = copied from an imported question paper whose
-- answer came from the publisher's own key; 'ai' = drafted by the AI router
-- from the chapter's name and topics; 'teacher' = written by a teacher.
-- Only review = 'approved' is ever put in front of a child. AI drafts start
-- 'pending' and wait for a teacher.
create table if not exists public.game_questions (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  grade int not null check (grade between -2 and 12),
  class_id text not null default '',
  subject_key text not null,
  textbook_id text not null default '',
  chapter_position int,
  chapter_name text not null default '',
  lang text not null default 'en' check (lang in ('en', 'hi')),
  prompt text not null check (length(prompt) between 1 and 400),
  options jsonb not null,
  answer_index int not null check (answer_index between 0 and 5),
  source text not null check (source in ('publisher_key', 'ai', 'teacher')),
  -- Where it came from: "<paperId>:<setId>:<questionId>" for a paper, the
  -- ai_generations id + item number for a draft, the question's own id for a
  -- teacher's — unique per source, so an import run twice adds nothing.
  source_ref text not null,
  review text not null default 'pending' check (review in ('approved', 'pending', 'rejected')),
  reviewed_by text not null default '',
  reviewed_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists game_questions_source_ref_uq
  on public.game_questions (tenant_id, source, source_ref);
create index if not exists game_questions_pool_idx
  on public.game_questions (tenant_id, grade, subject_key, review);

-- ── Competitions a teacher launches ──────────────────────────────────────
create table if not exists public.game_competitions (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null default '',
  game text not null check (game in ('quiz', 'maths_speed')),
  -- [{classId, sectionId, label}] — the sections competing.
  sections jsonb not null,
  -- For a quiz: where the questions came from.
  grade int,
  subject_key text not null default '',
  textbook_id text not null default '',
  chapter_position int,
  -- The same items for every player (with answers — never sent to a phone).
  items jsonb not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'cancelled')),
  created_by_staff_id text not null default '',
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  check (closes_at > opens_at)
);

create index if not exists game_competitions_window_idx
  on public.game_competitions (tenant_id, closes_at desc);

-- ── A child's play ───────────────────────────────────────────────────────
create table if not exists public.game_sessions (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id text not null,
  household_id text not null default '',
  -- Shown on leaderboards: first name and class only (no surname, phone or photo).
  player_name text not null default '',
  class_id text not null default '',
  section_id text not null default '',
  class_label text not null default '',
  competition_id text references public.game_competitions(id) on delete cascade,
  game text not null check (game in ('quiz', 'maths_speed')),
  grade int,
  subject_key text not null default '',
  textbook_id text not null default '',
  chapter_position int,
  -- [{prompt, options, answer, qid?}] — `answer` stays on the server.
  items jsonb not null,
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  ended_at timestamptz,
  status text not null default 'playing' check (status in ('playing', 'done')),
  -- Written by the server when the session ends, from game_answers.
  answered int not null default 0,
  correct int not null default 0,
  stars int not null default 0,
  seconds_played int not null default 0,
  -- IST calendar day of started_at, for the daily allowance.
  play_date text not null
);

-- One game at a time per child: a second start while one is open fails here.
create unique index if not exists game_sessions_one_open_uq
  on public.game_sessions (tenant_id, student_id) where status = 'playing';
-- One attempt per child per competition.
create unique index if not exists game_sessions_competition_once_uq
  on public.game_sessions (tenant_id, competition_id, student_id) where competition_id is not null;
create index if not exists game_sessions_student_day_idx
  on public.game_sessions (tenant_id, student_id, play_date);
create index if not exists game_sessions_section_day_idx
  on public.game_sessions (tenant_id, section_id, play_date);
create index if not exists game_sessions_competition_idx
  on public.game_sessions (tenant_id, competition_id);

create table if not exists public.game_answers (
  session_id text not null references public.game_sessions(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  idx int not null check (idx between 0 and 199),
  chosen int not null,
  correct boolean not null,
  answered_at timestamptz not null default now(),
  -- A question is answered once: a second answer to the same item is refused.
  primary key (session_id, idx)
);

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 (memory: erp-supabase-new-table-grant).
grant select, insert, update, delete on public.game_settings to service_role;
grant select, insert, update, delete on public.game_questions to service_role;
grant select, insert, update, delete on public.game_competitions to service_role;
grant select, insert, update, delete on public.game_sessions to service_role;
grant select, insert, update, delete on public.game_answers to service_role;

-- Nothing here is for the browser's anon key.
alter table public.game_settings enable row level security;
alter table public.game_questions enable row level security;
alter table public.game_competitions enable row level security;
alter table public.game_sessions enable row level security;
alter table public.game_answers enable row level security;

notify pgrst, 'reload schema';
