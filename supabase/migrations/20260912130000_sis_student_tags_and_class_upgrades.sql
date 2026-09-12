-- Student tags and the class-upgrade history: out of one browser, into tables.
--
-- `SisState` carries six parts. Four are stored: households and students in
-- their own tables, curriculum through curriculumPersistence, and everything
-- else on a student in sis_students.profile. Two were never stored anywhere at
-- all — `tags` (the tag definitions: Staff ward, Sibling, RTE, EWS, Sports,
-- Special care, plus whatever the office adds) and `classUpgrades` (the record
-- of a child moved to another class or section after admission, with the fee
-- group and student type it moved between, who did it and why).
--
-- Both lived only in the localStorage of whichever machine happened to write
-- them. Consequences, in order of how much they matter:
--
--   * A student's `tagIds` NOW persist (migration 20260912100000). The names
--     they point at did not, so a tag id could arrive in a browser with no
--     definition for it — and `assignStudentTags` filters to ids it can name,
--     so editing that child's tags THERE silently dropped the tag. A shared id
--     pointing at private names is worse than not syncing at all.
--   * The class-upgrade history is the only record of a post-admission move.
--     It is read to explain a child's fee group ("moved from II-B on 2026-07-04
--     by the principal"), and it was one cleared cache from gone.
--
-- The tag ids of the six defaults are derived from their code from now on
-- (`stag_rte`, not `stag_7fk29d0a`), because a random per-browser id for a
-- shared row is how two machines end up with twelve default tags for six
-- meanings. See the localStorage-first notes: per-browser ids are a recurring
-- trap here.
--
-- No delete path for either table, because the app has none: a tag is retired
-- with `isActive: false` and history is append-only. So the push is
-- upsert-only — nothing can be pruned by absence, which is the failure mode
-- that has cost this project data twice.
create table if not exists public.sis_student_tags (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null default '',
  name text not null default '',
  color text not null default '',
  is_active boolean not null default true,
  -- The client's own ISO string, kept verbatim: it is what the UI sorts and
  -- displays, and a timestamptz round trip would hand back a different
  -- spelling of the same instant.
  created_at text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists sis_student_tags_tenant_idx
  on public.sis_student_tags (tenant_id, is_active);

create table if not exists public.sis_class_upgrades (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Not a foreign key to sis_students on purpose: this is history, and it must
  -- survive the child's row being merged into a duplicate or removed. The
  -- name and admission number are copied in for the same reason.
  student_id text not null default '',
  student_name text not null default '',
  admission_no text not null default '',
  from_class_id text not null default '',
  from_section_id text not null default '',
  to_class_id text not null default '',
  to_section_id text not null default '',
  from_fee_group_id text,
  to_fee_group_id text,
  from_student_type text not null default '',
  to_student_type text not null default '',
  reason text not null default '',
  -- Both are the school's own calendar strings (YYYY-MM-DD / ISO), stored as
  -- text for the same reason as created_at above.
  effective_on text not null default '',
  created_at text not null default '',
  created_by text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists sis_class_upgrades_student_idx
  on public.sis_class_upgrades (tenant_id, student_id);
create index if not exists sis_class_upgrades_recent_idx
  on public.sis_class_upgrades (tenant_id, created_at desc);

comment on table public.sis_student_tags is
  'Student tag definitions (code, name, colour, retired flag). Ids of the six defaults are derived from the code so every browser agrees on them.';
comment on table public.sis_class_upgrades is
  'Append-only history of post-admission class / section / fee-group moves. Deliberately not FK-bound to sis_students: the history outlives the row.';

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 and the request "succeeds" while storing nothing.
grant all on public.sis_student_tags to service_role;
grant all on public.sis_class_upgrades to service_role;

notify pgrst, 'reload schema';
