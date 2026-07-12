-- Sibling discount by child number (2nd, 3rd, 4th+).

alter table public.concession_rules
  add column if not exists sibling_tiers jsonb not null default '[]'::jsonb;

alter table public.concession_grants
  add column if not exists sibling_child_no int;

comment on column public.concession_rules.sibling_tiers is
  'Array of {childNo, mode, value} for sibling discounts; last tier covers higher child numbers';
comment on column public.concession_grants.sibling_child_no is
  'Which child ordinal this grant applies as (2=2nd child, …); null = flat rule value';
