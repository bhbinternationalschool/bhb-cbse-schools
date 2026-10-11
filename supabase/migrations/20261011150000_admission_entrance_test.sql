/*
 * Admission entrance test (the old SStudy ERP's "admission exam": set the
 * test date, enter registration subject marks, the exam summary, mark
 * selected / not selected, message the family).
 *
 * Two tables, both SERVER truth, read and written only through
 * /api/admissions/entrance-test. Nothing here lives in the admissions desk
 * (admission_desk_leads keeps saving exactly as before); a candidate row
 * points at its lead by id and carries a snapshot of the name, class and
 * numbers taken when the child was put on the roll, so the roll list and the
 * attendance sheet print the same thing the invigilator was given even if
 * the lead is edited later.
 *
 * admission_entrance_sessions — one sitting: name, date, start time, venue,
 *   the classes it is for, the subjects with their maximum marks, and the
 *   pass mark (and an optional lower waitlist mark) as a percentage.
 *   subjects = [{ "id": "s1", "name": "English", "maxMarks": 25 }, …]
 *
 * admission_entrance_candidates — one child in one sitting.
 *   marks = { "<subject id>": <number> }. A subject with no key has NOT been
 *   entered — it is never read as zero, so a half-entered child has no total
 *   and no suggested result.
 *   result_status '' = not decided yet; status_source says whether the
 *   pass-mark rule set it or a person overrode it (a rule re-run never
 *   overwrites a manual decision).
 *   invite_/result_claimed_at: a send claims the row in one conditional
 *   update before messaging (two staff pressing Send together cannot both
 *   message a family); cleared when the send fails, kept for 10 minutes
 *   after a success so a double-clicked re-send is refused too.
 *   updated_at is the row stamp: a marks save names the stamp it loaded and
 *   is refused when someone else saved the row in between.
 *
 * A sitting with children on its roll cannot be deleted (on delete
 * restrict): the roll is removed explicitly, child by child, first.
 */

create table if not exists public.admission_entrance_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  academic_year_code text not null,
  name text not null,
  test_date date not null,
  start_time text not null default '',
  venue text not null default '',
  class_ids text[] not null default '{}',
  subjects jsonb not null default '[]'::jsonb,
  pass_percent numeric(5,2) not null default 40
    check (pass_percent >= 0 and pass_percent <= 100),
  waitlist_percent numeric(5,2)
    check (waitlist_percent is null or (waitlist_percent >= 0 and waitlist_percent <= 100)),
  notes text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists admission_entrance_sessions_tenant_idx
  on public.admission_entrance_sessions (tenant_id, academic_year_code, test_date);

create table if not exists public.admission_entrance_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.admission_entrance_sessions(id) on delete restrict,
  lead_id text not null,
  roll_no text not null,
  child_name text not null default '',
  guardian_name text not null default '',
  mobile text not null default '',
  class_id text not null default '',
  application_no text not null default '',
  enquiry_no text not null default '',
  absent boolean not null default false,
  marks jsonb not null default '{}'::jsonb,
  result_status text not null default ''
    check (result_status in ('', 'selected', 'waitlisted', 'not_selected', 'absent')),
  status_source text not null default ''
    check (status_source in ('', 'rule', 'manual')),
  status_set_by text not null default '',
  status_set_at timestamptz,
  invite_sent_at timestamptz,
  result_sent_at timestamptz,
  invite_claimed_at timestamptz,
  result_claimed_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, lead_id),
  unique (session_id, roll_no)
);

create index if not exists admission_entrance_candidates_session_idx
  on public.admission_entrance_candidates (tenant_id, session_id);
create index if not exists admission_entrance_candidates_lead_idx
  on public.admission_entrance_candidates (tenant_id, lead_id);

comment on table public.admission_entrance_sessions is
  'Admission entrance test sittings (Admissions → Entrance test). Server truth; written only via /api/admissions/entrance-test.';
comment on table public.admission_entrance_candidates is
  'One applicant (admission_desk_leads.id) on one entrance test sitting: roll no, marks per subject, absent flag, result. Server truth.';

/* ─── RLS + grants ─────────────────────────────────────────── */
-- Every new table needs the service_role grant spelled out, or the server's
-- writes fail with a bare 42501 that reads like a bug in the caller. No
-- browser policy: the app reads and writes these through the service role.

alter table public.admission_entrance_sessions enable row level security;
alter table public.admission_entrance_candidates enable row level security;

grant select, insert, update, delete on public.admission_entrance_sessions to service_role;
grant select, insert, update, delete on public.admission_entrance_candidates to service_role;

notify pgrst, 'reload schema';
