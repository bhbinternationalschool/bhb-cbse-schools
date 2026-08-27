-- Inter-school events: competitions the school hosts for its own students AND
-- other schools' students. Outside students live ONLY here — never in
-- sis_students, UDISE exports, or fee rosters. Server-first because the
-- registration and transparency pages are public: the browser store can
-- never be the truth for someone else's school.

create table if not exists public.evt_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  slug text not null,
  event_date date,
  venue text not null default '',
  -- Rules, judging rubric, judges' names — published BEFORE registration
  -- opens; the public page shows this verbatim.
  description text not null default '',
  registration_closes_on date,
  entry_fee_paise bigint not null default 0,
  -- Trophies / printing / other costs, shown on the public accounts tab.
  other_costs_paise bigint not null default 0,
  status text not null default 'draft', -- draft | open | closed | completed
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table if not exists public.evt_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  event_id uuid not null references public.evt_events(id) on delete cascade,
  name text not null,
  class_band text not null default '',
  prize1_paise bigint not null default 0,
  prize2_paise bigint not null default 0,
  prize3_paise bigint not null default 0,
  prize_notes text not null default '',
  results_locked_at timestamptz,
  locked_by text not null default '',
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.evt_participants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  event_id uuid not null references public.evt_events(id) on delete cascade,
  category_id uuid not null references public.evt_categories(id) on delete cascade,
  student_name text not null,
  school_name text not null,
  class_label text not null default '',
  guardian_mobile text not null default '',
  is_own_student boolean not null default false,
  sis_student_id text not null default '',
  status text not null default 'pending', -- pending | approved | rejected
  fee_status text not null default 'na',  -- na | due | paid
  fee_paise bigint not null default 0,
  payment_ref text not null default '',
  source text not null default 'public',  -- public | office
  public_consent boolean not null default true,
  score numeric,
  rank int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists evt_participants_event_idx
  on public.evt_participants (tenant_id, event_id, category_id);

create table if not exists public.evt_prize_payouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  event_id uuid not null,
  participant_id uuid not null references public.evt_participants(id) on delete cascade,
  amount_paise bigint not null,
  handed_at timestamptz not null default now(),
  handed_by text not null default '',
  note text not null default ''
);

create table if not exists public.evt_certificates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  event_id uuid not null,
  participant_id uuid not null references public.evt_participants(id) on delete cascade,
  kind text not null, -- winner | participation
  rank int,
  issued_at timestamptz not null default now(),
  unique (tenant_id, participant_id, kind)
);

-- Post-lock corrections are public record: reason, who, when.
create table if not exists public.evt_result_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  event_id uuid not null,
  category_id uuid not null,
  reason text not null,
  revised_by text not null default '',
  revised_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array[
    'evt_events','evt_categories','evt_participants',
    'evt_prize_payouts','evt_certificates','evt_result_revisions'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_all', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_tenant_member(tenant_id))',
      t || '_tenant_all', t
    );
    -- Service role must be granted explicitly or writes 42501 silently.
    execute format(
      'grant select, insert, update, delete on public.%I to service_role', t
    );
  end loop;
end
$$;

notify pgrst, 'reload schema';
