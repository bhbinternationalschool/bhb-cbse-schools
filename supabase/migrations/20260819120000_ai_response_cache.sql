-- AI response cache (roadmap §6, 2026-08-19).
--
-- Deterministic drafts (certificates, staff agreements, school documents,
-- lesson plans) keyed by sha256(route + prompt version + tier + system +
-- user message). Same input → same output without another paid call.
-- Personalised generators (remarks, PTM briefs, at-risk notes) never use
-- it. Rows expire by created_at (30 days) at read time.

create table if not exists public.ai_response_cache (
  cache_key text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  route text not null,
  engine text not null,
  model text not null default '',
  response text not null,
  generation_id text not null default '',
  hits integer not null default 0,
  created_at timestamptz not null default now(),
  last_hit_at timestamptz
);

create index if not exists ai_response_cache_tenant_route_idx
  on public.ai_response_cache (tenant_id, route, created_at desc);

grant all on public.ai_response_cache to service_role;

notify pgrst, 'reload schema';
