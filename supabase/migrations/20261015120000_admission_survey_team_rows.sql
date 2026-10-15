-- Field survey team and beats as rows, written through the write kernel
-- (director, 15 Oct 2026: "I assigned 1 staff in the ERP but the app still
-- shows not assigned").
--
-- APPLY TO PRODUCTION BEFORE THE APP THAT USES IT IS DEPLOYED. Without these
-- tables the new code fails closed (the survey team screen and the survey-day
-- status answer "could not read"); it never falls back to the old copy.
--
-- Until now the survey team and the beats were two lists inside one jsonb
-- row (admission_desk_field_ops.ops_json) that every admissions save wrote
-- whole from its own copy of the desk. Here each member and each beat is one
-- row, written one change at a time by desk_write_guarded (base = the row's
-- updated_at, all-or-none, the change signal bumped in the same transaction),
-- so a stale copy can neither drop nor revert one, and erp_versions
-- ("admission_survey") tells every open screen that something changed.
--
-- The whole-desk admissions save no longer writes these two lists (the app
-- strips them); what is stored in ops_json today is copied here once, below,
-- keeping every id (leads point at their beat by id).

create table if not exists public.admission_survey_members (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('staff', 'external')),
  staff_id text not null default '',
  external_id text not null default '',
  full_name text not null default '',
  mobile text not null default '',
  emp_code text not null default '',
  note text not null default '',
  role text not null default 'agent' check (role in ('leader', 'agent')),
  -- true = the member may start a survey day on the app.
  assigned boolean not null default true,
  -- 'school' = starts with the gate QR code inside the campus; 'field' = live GPS anywhere.
  start_mode text not null default 'school' check (start_mode in ('school', 'field')),
  -- The beats (survey areas) this member works; [] = any active beat.
  beat_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(beat_ids) = 'array'),
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'staff' or staff_id <> ''),
  check (kind <> 'external' or external_id <> '')
);

-- One row per staff member / outside worker per school.
create unique index if not exists admission_survey_members_staff_uq
  on public.admission_survey_members (tenant_id, staff_id) where kind = 'staff';
create unique index if not exists admission_survey_members_external_uq
  on public.admission_survey_members (tenant_id, external_id) where kind = 'external';

create table if not exists public.admission_survey_beats (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null default '',
  name text not null check (name <> ''),
  area text not null default '',
  target_households int not null default 0 check (target_households >= 0),
  is_active boolean not null default true,
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admission_survey_beats_tenant_idx on public.admission_survey_beats (tenant_id);

-- The change signal (erp_versions key "admission_survey").
create table if not exists public.admission_survey_sync_meta (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  member_count int not null default 0,
  beat_count int not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.admission_survey_members is
  'Field survey team: one row per member (staff or outside worker), role, start mode, beats. Written only through desk_write_guarded.';
comment on table public.admission_survey_beats is
  'Field survey beats (areas). Written only through desk_write_guarded; leads point at a beat by id.';
comment on table public.admission_survey_sync_meta is
  'Change signal for the survey team and beats, bumped by desk_write_guarded.';

alter table public.admission_survey_members enable row level security;
alter table public.admission_survey_beats enable row level security;
alter table public.admission_survey_sync_meta enable row level security;
revoke all on public.admission_survey_members from public, anon, authenticated;
revoke all on public.admission_survey_beats from public, anon, authenticated;
revoke all on public.admission_survey_sync_meta from public, anon, authenticated;
-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 while the request "succeeds".
grant select, insert, update, delete on public.admission_survey_members to service_role;
grant select, insert, update, delete on public.admission_survey_beats to service_role;
grant select, insert, update, delete on public.admission_survey_sync_meta to service_role;

insert into public.desk_writable_tables (table_name, soft_delete, note, sync_meta_table, sync_count_column) values
  ('admission_survey_members', false, 'Field survey team (15 Oct 2026); removal is a hard delete, audited', 'admission_survey_sync_meta', 'member_count'),
  ('admission_survey_beats', false, 'Field survey beats (15 Oct 2026); the UI retires a beat (is_active), leads keep its id', 'admission_survey_sync_meta', 'beat_count')
on conflict (table_name) do update
  set sync_meta_table = excluded.sync_meta_table, sync_count_column = excluded.sync_count_column, note = excluded.note;

-- ── Copy what ops_json holds today (ids kept) ─────────────────────────────

insert into public.admission_survey_beats (id, tenant_id, code, name, area, target_households, is_active, note, created_at, updated_at)
select b->>'id', f.tenant_id,
       coalesce(b->>'code', ''),
       coalesce(nullif(trim(b->>'name'), ''), b->>'id'),
       coalesce(b->>'area', ''),
       greatest(0, coalesce(case when (b->>'targetHouseholds') ~ '^\d+(\.\d+)?$' then round((b->>'targetHouseholds')::numeric)::int end, 0)),
       coalesce(case when jsonb_typeof(b->'isActive') = 'boolean' then (b->>'isActive')::boolean end, true),
       coalesce(b->>'note', ''),
       coalesce(case when (b->>'createdAt') ~ '^\d{4}-\d{2}-\d{2}' then (b->>'createdAt')::timestamptz end, now()),
       now()
  from public.admission_desk_field_ops f
  cross join lateral jsonb_array_elements(case when jsonb_typeof(f.ops_json->'surveyBeats') = 'array' then f.ops_json->'surveyBeats' else '[]'::jsonb end) b
 where coalesce(b->>'id', '') <> ''
on conflict (id) do nothing;

insert into public.admission_survey_members (id, tenant_id, kind, staff_id, external_id, full_name, mobile, emp_code, role, assigned, start_mode, created_at, updated_at)
select distinct on (f.tenant_id, coalesce(m->>'kind','staff'), case when m->>'kind' = 'external' then m->>'externalId' else m->>'staffId' end)
       m->>'id', f.tenant_id,
       case when m->>'kind' = 'external' then 'external' else 'staff' end,
       case when m->>'kind' = 'external' then '' else coalesce(m->>'staffId', '') end,
       case when m->>'kind' = 'external' then coalesce(m->>'externalId', '') else '' end,
       coalesce(m->>'fullName', ''), coalesce(m->>'mobile', ''), coalesce(m->>'empCode', ''),
       case when m->>'role' = 'leader' then 'leader' else 'agent' end,
       coalesce(case when jsonb_typeof(m->'assigned') = 'boolean' then (m->>'assigned')::boolean end, true),
       case when m->>'startMode' = 'field' then 'field' else 'school' end,
       coalesce(case when (m->>'createdAt') ~ '^\d{4}-\d{2}-\d{2}' then (m->>'createdAt')::timestamptz end, now()),
       now()
  from public.admission_desk_field_ops f
  cross join lateral jsonb_array_elements(case when jsonb_typeof(f.ops_json->'surveyTeam') = 'array' then f.ops_json->'surveyTeam' else '[]'::jsonb end) m
 where coalesce(m->>'id', '') <> ''
   and ((m->>'kind' = 'external' and coalesce(m->>'externalId', '') <> '')
        or (coalesce(m->>'kind', 'staff') <> 'external' and coalesce(m->>'staffId', '') <> ''))
on conflict do nothing;

insert into public.admission_survey_sync_meta (tenant_id, member_count, beat_count, updated_at)
select t.id,
       (select count(*) from public.admission_survey_members m where m.tenant_id = t.id),
       (select count(*) from public.admission_survey_beats b where b.tenant_id = t.id),
       now()
  from public.tenants t
on conflict (tenant_id) do update
  set member_count = excluded.member_count, beat_count = excluded.beat_count, updated_at = excluded.updated_at;

-- ── Families recorded WITHOUT a survey day (staff app, 15 Oct 2026) ────────
-- A member of staff may record a family on any day, with the location taken
-- from the phone or picked on a map. The point is kept beside the day's
-- captures with no day: survey_day_id null, located_by says how.
alter table public.survey_captures alter column survey_day_id drop not null;
alter table public.survey_captures
  add column if not exists located_by text not null default 'gps'
    check (located_by in ('gps', 'map'));
create index if not exists survey_captures_no_day_idx
  on public.survey_captures (tenant_id, captured_at) where survey_day_id is null;
comment on column public.survey_captures.located_by is
  'gps = the phone''s live fix; map = the surveyor placed the pin on a map (no survey day).';

notify pgrst, 'reload schema';
