-- Authoritative learning standards, and the map from them to our own chapters.
--
-- WHY (director's decision, 22 Sep 2026): a lesson plan's learning outcomes
-- are typed by the teacher or, when the box is empty, guessed by the model
-- from the chapter title (lib/lessonPlanAi.ts says so in as many words). The
-- exam drill has the same hole one level down: `skill` — the thing a question
-- is said to test — is three or four words the model invents per question, so
-- two drills on the same chapter test "unitary method" and "value of one",
-- and neither the retry nor the avoid-list can tell they are one idea.
--
-- The CASE Network publishes what those outcomes actually are, sentence by
-- sentence, and for mathematics it publishes two more things nobody here can
-- derive: the micro-skills inside a standard, and which standard must come
-- FIRST. That last one is what turns "you got it wrong, here is an easier
-- one" into "you got it wrong because you cannot yet do the thing underneath
-- it, so we go there".
--
-- Seeded, NOT fetched. The CASE Network is reachable from a developer's
-- tools, not from this app: nothing here calls it at request time, so a drill
-- at nine at night never waits on anyone else's uptime. The seed is a second
-- migration; this one only makes room for it.
--
-- WHAT THIS IS NOT: the standards are American (CCSS for mathematics, NGSS
-- for science). They are held here as a source of well-formed OUTCOME
-- SENTENCES and, for maths, of prerequisite order — never as curriculum. No
-- code from this table is ever shown to a teacher, a parent or a child; the
-- screens show `statement`, reworded to the chapter in front of them. The
-- books remain Propel (director's decision, 16 Sep 2026).
--
-- Grade numbers do NOT line up and are not meant to. Propel Class 5 sets
-- profit and loss; the standard that covers it is written for American grade
-- 7. Chapters are mapped by what they TEACH, never by the number on the book,
-- which is why `grade_low`/`grade_high` are recorded but never joined on.

/* ── reference: the standards themselves ─────────────────────────────
   Not tenant-scoped. These are published facts, identical for every
   school, and copying them per tenant would only invite two tenants to
   disagree about what a standard says. */

create table if not exists public.learning_standards (
  case_uuid uuid primary key,
  -- 'RI.5.2', '3.NF.A.1', 'MS-PS1-1' — the publisher's own code.
  code text not null unique check (length(trim(code)) > 0),
  -- Which publication the code belongs to. Only these three are seeded;
  -- the check keeps a fourth from arriving unannounced.
  framework text not null check (framework in ('ccss-math', 'ccss-ela', 'ngss')),
  subject text not null check (length(trim(subject)) > 0),
  -- The sentence. This is the only column any screen is allowed to show.
  statement text not null check (length(trim(statement)) > 0),
  -- The publisher's grade band, as published. NGSS middle school is a band
  -- of three (6-8) and says so by having low <> high; CCSS is one grade.
  -- Recorded for review, never used to choose a standard for a chapter.
  grade_low smallint not null check (grade_low between -2 and 12),
  grade_high smallint not null check (grade_high between -2 and 12),
  fetched_at timestamptz not null default now(),
  check (grade_high >= grade_low)
);

create index if not exists learning_standards_framework_idx
  on public.learning_standards (framework, grade_low);

/* ── reference: micro-skills inside a standard (mathematics only) ──── */

create table if not exists public.learning_standard_components (
  case_uuid uuid not null references public.learning_standards (case_uuid) on delete cascade,
  -- The CASE Network's own component id, so a re-seed updates in place.
  component_id uuid not null,
  description text not null check (length(trim(description)) > 0),
  primary key (case_uuid, component_id)
);

/* ── reference: what has to come first (mathematics only) ────────────
   One row per edge of the SAP Coherence Map, in the direction the drill
   walks it: `prereq_case_uuid` is the standard a child needs BEFORE
   `case_uuid`. Both ends must already be seeded, so an edge can never
   point at a standard whose sentence we do not hold. */

create table if not exists public.learning_standard_prereqs (
  case_uuid uuid not null references public.learning_standards (case_uuid) on delete cascade,
  prereq_case_uuid uuid not null references public.learning_standards (case_uuid) on delete cascade,
  primary key (case_uuid, prereq_case_uuid),
  -- A standard is not its own prerequisite; without this, one bad seed row
  -- sends the drill's backward walk round in a circle for ever.
  check (case_uuid <> prereq_case_uuid)
);

create index if not exists learning_standard_prereqs_reverse_idx
  on public.learning_standard_prereqs (prereq_case_uuid);

/* ── ours: which standard belongs to which chapter of our books ──────
   Tenant-scoped, because this is a judgement about OUR books, not a
   published fact. `reviewed_at` is null until a teacher has agreed with
   it, and nothing in the app may read an unreviewed row — see
   learning_chapter_outcomes below, which is the only way in. */

create table if not exists public.textbook_chapter_standards (
  tenant_id uuid not null,
  textbook_id text not null,
  position smallint not null,
  case_uuid uuid not null references public.learning_standards (case_uuid) on delete cascade,
  -- How sure the seed was. 'high' = the chapter and the standard teach the
  -- same thing; 'medium' = the standard covers part of the chapter, or the
  -- chapter spans a band (NGSS 6-8) and the grade could not be pinned.
  confidence text not null default 'medium' check (confidence in ('high', 'medium')),
  -- Why this chapter got this standard, in one line, for the teacher who
  -- has to agree or disagree with it.
  rationale text not null default '',
  reviewed_at timestamptz,
  reviewed_by text not null default '',
  -- Set when a teacher says the match is wrong. Kept rather than deleted so
  -- the next re-seed does not cheerfully propose it again.
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, textbook_id, position, case_uuid),
  foreign key (tenant_id, textbook_id, position)
    references public.school_textbook_chapters (tenant_id, textbook_id, position) on delete cascade,
  check (reviewed_at is null or rejected_at is null)
);

create index if not exists textbook_chapter_standards_pending_idx
  on public.textbook_chapter_standards (tenant_id, textbook_id, position)
  where reviewed_at is null and rejected_at is null;

/* ── the only door in ─────────────────────────────────────────────────
   Every screen reads THIS, never the table. A match a teacher has not
   yet agreed with cannot reach a lesson plan or a drill by accident,
   because it is not in here to be read. */

create or replace view public.learning_chapter_outcomes as
  select
    m.tenant_id,
    m.textbook_id,
    m.position,
    s.case_uuid,
    s.framework,
    s.subject,
    s.statement,
    m.confidence
  from public.textbook_chapter_standards m
  join public.learning_standards s on s.case_uuid = m.case_uuid
  where m.reviewed_at is not null
    and m.rejected_at is null;

alter table public.learning_standards enable row level security;
alter table public.learning_standard_components enable row level security;
alter table public.learning_standard_prereqs enable row level security;
alter table public.textbook_chapter_standards enable row level security;

-- Reference rows are the same for everyone and carry no tenant column, so
-- membership of any tenant is the whole test. They are read-only to the app:
-- only a seed migration (service_role) writes them.
drop policy if exists learning_standards_read on public.learning_standards;
create policy learning_standards_read on public.learning_standards
  for select to authenticated using (true);

drop policy if exists learning_standard_components_read on public.learning_standard_components;
create policy learning_standard_components_read on public.learning_standard_components
  for select to authenticated using (true);

drop policy if exists learning_standard_prereqs_read on public.learning_standard_prereqs;
create policy learning_standard_prereqs_read on public.learning_standard_prereqs
  for select to authenticated using (true);

drop policy if exists textbook_chapter_standards_tenant_read on public.textbook_chapter_standards;
create policy textbook_chapter_standards_tenant_read on public.textbook_chapter_standards
  for select to authenticated using (public.is_tenant_member(tenant_id));

-- The review screen writes here directly: a teacher agreeing with a match is
-- an ordinary edit by an ordinary signed-in user, not a job for a server key.
drop policy if exists textbook_chapter_standards_tenant_review on public.textbook_chapter_standards;
create policy textbook_chapter_standards_tenant_review on public.textbook_chapter_standards
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select on public.learning_standards to authenticated;
grant select on public.learning_standard_components to authenticated;
grant select on public.learning_standard_prereqs to authenticated;
grant select, update on public.textbook_chapter_standards to authenticated;
grant select on public.learning_chapter_outcomes to authenticated;

grant select, insert, update, delete on public.learning_standards to service_role;
grant select, insert, update, delete on public.learning_standard_components to service_role;
grant select, insert, update, delete on public.learning_standard_prereqs to service_role;
grant select, insert, update, delete on public.textbook_chapter_standards to service_role;
grant select on public.learning_chapter_outcomes to service_role;

comment on table public.learning_standards is
  'CASE Network standards, seeded. Source of outcome SENTENCES and (maths) prerequisite order. `code` is never shown to a teacher, parent or child.';
comment on table public.learning_standard_prereqs is
  'SAP Coherence Map edges, mathematics only: prereq_case_uuid must be understood before case_uuid. Walked backward by the exam drill after a wrong answer.';
comment on table public.textbook_chapter_standards is
  'Which standard a Propel chapter teaches. Our judgement, not a published fact — unusable until a teacher sets reviewed_at.';
comment on view public.learning_chapter_outcomes is
  'Teacher-approved chapter outcomes. The ONLY thing app code may read: unreviewed and rejected matches are absent by construction.';

notify pgrst, 'reload schema';
