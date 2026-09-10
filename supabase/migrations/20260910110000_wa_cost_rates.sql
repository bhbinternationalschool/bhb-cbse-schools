-- What the school pays per WhatsApp message — the school's own figures.
--
-- Meta's price list is not a constant. It differs by country, by account
-- and by whatever the BSP quoted, and it has changed twice in the life of
-- this ERP. Hardcoding a rate would produce a dashboard that reads like a
-- bill and matches no invoice, which is worse than showing counts alone.
--
-- So the rates live here, set by the office from its own rate card, with
-- who set them and when — because the first question about any cost figure
-- is "says who, and how old is that number?".
--
-- Stored in PAISE per message, decimals allowed: a utility message at
-- ₹0.1146 is 11.46 paise, and rounding that to 11 is a 4% error on the
-- school's largest category. Money elsewhere in the ERP is whole paise;
-- a rate is not money, it is the multiplier.

create table if not exists public.wa_cost_rates (
  tenant_id uuid primary key,
  rates jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

alter table public.wa_cost_rates enable row level security;

create policy wa_cost_rates_tenant_all
  on public.wa_cost_rates
  for all
  using (is_tenant_member(tenant_id));

comment on table public.wa_cost_rates is
  'Per-message WhatsApp rates in paise, set by the school from its own Meta/BSP rate card. One row per tenant.';
