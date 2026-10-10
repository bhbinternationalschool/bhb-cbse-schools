-- Who gets the tutor free, who gets it cheaper, and until when — decided by
-- the school on a screen, not by a deploy.
--
-- WHY (director, 19 Sep 2026): "make it free until exam date… why not you
-- providing us feature on screen that self decide daily/weekly/monthly pass
-- rate and how much discount… for any class or any student or bulk and also
-- till which date we want to provide free trial".
--
-- Until now: prices lived in AI_TUTOR_PLANS_JSON, an environment variable
-- that takes a deploy to change, and "free" meant one 24-hour trial per
-- child, ever. The school could not make its own tutor free for its own
-- exam week without an engineer. That is the wrong place for a pricing
-- decision to live.
--
-- Two tables, each with one job.

-- 1. What a pass costs. Overrides the env default when rows exist here, so
--    an empty table changes nothing and a bad edit can be undone by
--    deleting the row.
create table if not exists public.tutor_plan_prices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  label text not null default '',
  days integer not null check (days > 0 and days <= 366),
  price_paise integer not null check (price_paise >= 0),
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (tenant_id, code)
);

-- 2. Free windows and discounts, each aimed at everybody, one class, or one
--    child. Rows, not settings: a grant has a date, an author and a reason,
--    and "who decided the whole school got this free" is a question that
--    gets asked later.
create table if not exists public.tutor_access_rules (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  id uuid not null default gen_random_uuid(),

  -- 'free'     — the full tutor, at no charge, until free_until (inclusive)
  -- 'discount' — percent off every pass price, while the window lasts
  kind text not null check (kind in ('free', 'discount')),

  -- 'all' | 'class' | 'student'. A class rule carries the class id; a
  -- student rule the student id. Bulk is several student rows written in
  -- one action, so every child's grant can be withdrawn on its own.
  scope text not null check (scope in ('all', 'class', 'student')),
  scope_id text not null default '',

  -- Inclusive last day, in IST. Null on a discount means "until withdrawn";
  -- a free grant without a date would never end, so it is required there.
  free_until date,
  discount_percent smallint check (discount_percent between 1 and 100),

  note text not null default '',
  is_active boolean not null default true,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),

  -- A free rule needs a date; a discount needs a percentage. Neither can be
  -- half-written, because a half-written rule is read at runtime by code
  -- that has to decide whether a child may ask a question.
  constraint tutor_access_rule_shape check (
    (kind = 'free' and free_until is not null and discount_percent is null)
    or (kind = 'discount' and discount_percent is not null)
  ),
  constraint tutor_access_scope_id check (
    (scope = 'all' and scope_id = '') or (scope <> 'all' and scope_id <> '')
  )
);

create index if not exists tutor_access_rules_live_idx
  on public.tutor_access_rules (tenant_id, is_active, kind, scope);

alter table public.tutor_plan_prices enable row level security;
alter table public.tutor_access_rules enable row level security;

-- A new table gets no grants by default and every write fails 42501 in
-- silence ([[erp-supabase-new-table-grant]]).
grant all on public.tutor_plan_prices to service_role;
grant all on public.tutor_access_rules to service_role;
