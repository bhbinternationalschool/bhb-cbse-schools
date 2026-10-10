-- The defaulter policy the school can actually edit, and the rounds a person
-- approves before any child loses anything.
--
-- WHY THE JULY TABLES COULD NEVER HAVE WORKED
-- 20260711010000_fee_defaulter_playbook.sql created fee_recovery_policies,
-- fee_hold_policies and student_fee_holds, seeded them, and said in its own
-- header: "Demo UI uses in-app engine; tables ready when Fee Take ledger
-- lands." Two months on, fee_hold_policies holds nine correct-looking rows
-- that no TypeScript has ever read, and student_fee_holds is empty.
--
-- It is empty for a reason that would not have gone away on its own:
--
--     student_id uuid not null references public.students(id)
--
-- public.students has 0 rows. The live roster is public.sis_students, whose
-- id is TEXT. Every insert of a real child would have been rejected by that
-- foreign key. The table was unusable from the day it was created, and being
-- unused is the only reason nobody found out.
--
-- So the per-child tables below are keyed on sis_students(id) like every
-- other live table. student_fee_holds is left exactly where it is: dropping
-- a table on the strength of "nothing reads it" is how the wrong thing gets
-- dropped, and it costs nothing to leave an empty table alone.
--
-- WHY ROUNDS EXIST AT ALL
-- The holds engine decides by recomputing today's dues, so a hold appears and
-- disappears with the arithmetic. That is fine for a report card, which can be
-- printed again an hour later. It is wrong for a bus seat: somebody must tell
-- a family in advance, and a child turned away at the gate cannot be
-- un-turned-away. Measured against production on 13 Sep 2026 the existing
-- settings would take the bus from 102 of the 155 children who ride it, in
-- silence, the moment anything read them.
--
-- A round is the list a human reads and signs. Nothing here withholds
-- anything by itself.

/* ─── the policy the school edits ──────────────────────────── */

-- fee_hold_policies already carries hold_code, from_stage, mode and enabled.
-- What it never had is a money floor, which is the reason its own S3 row
-- ("16 days AND Rs 1,000", written in July) has never been honoured: the
-- stage ladder in playbook.ts reads days and ignores amount entirely, so a
-- child fifty rupees short for a fortnight ranks with one owing forty
-- thousand.

alter table public.fee_hold_policies
  add column if not exists min_amount_paise bigint not null default 0,
  add column if not exists min_overdue_days int not null default 0,
  add column if not exists updated_at timestamptz not null default now();

comment on column public.fee_hold_policies.min_amount_paise is
  'Money floor for this gate. A child below it never qualifies however long the bill has been open. 0 = no floor, which is how the engine behaved before this column existed.';
comment on column public.fee_hold_policies.min_overdue_days is
  'Day floor applied on top of the stage, so a school can say "S3, but never before three weeks".';

-- 'off' joins 'auto' and 'suggest' so a gate can be switched off without
-- deleting the row and losing its settings. The old values are kept: 'suggest'
-- is what the TypeScript calls 'propose', and rewriting live rows to a new
-- spelling would be churn for its own sake.
alter table public.fee_hold_policies
  drop constraint if exists fee_hold_policies_mode_check;
alter table public.fee_hold_policies
  add constraint fee_hold_policies_mode_check
  check (mode in ('auto', 'suggest', 'off'));

/* ─── a round ──────────────────────────────────────────────── */

create table if not exists public.fee_hold_rounds (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  hold_code text not null check (hold_code in (
    'HOLD_REPORT_CARD', 'HOLD_TC', 'HOLD_CERT', 'HOLD_TRANSPORT',
    'HOLD_STORE_CREDIT', 'HOLD_LIBRARY', 'HOLD_ADMIT_CARD',
    'HOLD_TRIP', 'HOLD_NEXT_AY'
  )),

  /**
   * draft     — built, being decided. Withholds nothing.
   * applied   — a person signed it off. Decisions are now in force.
   * cancelled — abandoned. Withholds nothing, kept so the office can see
   *             that a round was considered and dropped.
   */
  status text not null default 'draft'
    check (status in ('draft', 'applied', 'cancelled')),

  /** The date whose dues the list was built from. */
  as_of date not null,
  academic_year_code text not null default '',

  created_at timestamptz not null default now(),
  created_by text not null default '',
  applied_at timestamptz,
  applied_by text not null default '',
  note text not null default '',
  updated_at timestamptz not null default now()
);

comment on table public.fee_hold_rounds is
  'One batch of defaulter decisions for a single service. A round withholds nothing until status is applied, and applying is a deliberate act by a person.';

create index if not exists fee_hold_rounds_open_idx
  on public.fee_hold_rounds (tenant_id, hold_code, status);

/* ─── the children in it ───────────────────────────────────── */

create table if not exists public.fee_hold_round_items (
  round_id text not null
    references public.fee_hold_rounds(id) on delete cascade,
  student_id text not null
    references public.sis_students(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  decision text not null default 'undecided'
    check (decision in ('undecided', 'disallow', 'allow')),

  /**
   * The facts AS THEY STOOD when the round was built, never recomputed.
   *
   * A family who pays on Tuesday must not silently vanish from a list the
   * office approved on Monday. The round still names them and the app reports
   * the bill has moved, so a person drops them. Recomputing on apply means
   * approving one list and applying a different one.
   */
  stage text not null check (stage in ('S0','S1','S2','S3','S4')),
  overdue_days int not null default 0,
  overdue_amount_paise bigint not null default 0,

  /** Required for an allow. A disallow's reason is the policy itself. */
  reason text not null default '',

  primary key (round_id, student_id)
);

comment on table public.fee_hold_round_items is
  'One child in one round, with the dues facts frozen at build time.';

create index if not exists fee_hold_round_items_student_idx
  on public.fee_hold_round_items (tenant_id, student_id);

/* ─── what an applied round leaves behind ──────────────────── */

create table if not exists public.fee_hold_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id text not null
    references public.sis_students(id) on delete cascade,
  hold_code text not null,

  /**
   * An 'allow' is kept, not dropped. Next month's round has to know this
   * family was looked at and spared, and by whom — otherwise the same
   * argument is had from scratch every cycle, which is how a concession
   * becomes folklore.
   */
  decision text not null check (decision in ('disallow', 'allow')),
  reason text not null default '',

  round_id text references public.fee_hold_rounds(id) on delete set null,
  stage text not null default 'S0',
  overdue_amount_paise bigint not null default 0,

  decided_at timestamptz not null default now(),
  decided_by text not null default '',

  /** Set when a later round, or a payment, supersedes this decision. */
  released_at timestamptz,
  released_by text not null default '',
  released_reason text not null default ''
);

comment on table public.fee_hold_decisions is
  'The standing decision for one child and one service. Enforcement reads this; nothing else writes a block.';

-- One live decision per child per service. A superseding decision releases
-- the old one rather than racing it.
create unique index if not exists fee_hold_decisions_live_idx
  on public.fee_hold_decisions (tenant_id, student_id, hold_code)
  where released_at is null;

create index if not exists fee_hold_decisions_round_idx
  on public.fee_hold_decisions (tenant_id, round_id);

/* ─── RLS + grants ─────────────────────────────────────────── */
-- Spelled out per table. A missing service_role grant fails as a bare 42501
-- that reads like a bug in the caller, and has cost this project two
-- incidents already.

alter table public.fee_hold_rounds enable row level security;
alter table public.fee_hold_round_items enable row level security;
alter table public.fee_hold_decisions enable row level security;

drop policy if exists fee_hold_rounds_tenant_read on public.fee_hold_rounds;
create policy fee_hold_rounds_tenant_read on public.fee_hold_rounds
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists fee_hold_round_items_tenant_read on public.fee_hold_round_items;
create policy fee_hold_round_items_tenant_read on public.fee_hold_round_items
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists fee_hold_decisions_tenant_read on public.fee_hold_decisions;
create policy fee_hold_decisions_tenant_read on public.fee_hold_decisions
  for select to authenticated using (public.is_tenant_member(tenant_id));

grant select on public.fee_hold_rounds to authenticated;
grant select on public.fee_hold_round_items to authenticated;
grant select on public.fee_hold_decisions to authenticated;

grant select, insert, update, delete on public.fee_hold_rounds to service_role;
grant select, insert, update, delete on public.fee_hold_round_items to service_role;
grant select, insert, update, delete on public.fee_hold_decisions to service_role;

-- fee_hold_policies predates the grant convention and gained columns above.
grant select on public.fee_hold_policies to authenticated;
grant select, insert, update, delete on public.fee_hold_policies to service_role;

notify pgrst, 'reload schema';
