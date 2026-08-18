-- AI generation audit trail (AI roadmap §6, 2026-08-18).
--
-- One row per LLM attempt made by the server-side router (lib/aiLlm.server.ts):
-- which route asked, which engine/model answered, prompt version, hashes of
-- the input and output (never the text — inputs carry student facts), token
-- usage, latency, who asked, and — filled in later by the UI — what the human
-- did with the draft (accepted / edited / rejected) and which record it ended
-- up on. Every generator becomes auditable in one place; the per-record
-- provenance flags (remark_source, LessonPlan.source, aiDrafted) stay as the
-- fast "was this AI?" answer on the record itself.

create table if not exists public.ai_generations (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- which generator, e.g. "report-remarks", "lesson-plan", "exam-paper"
  route text not null,
  prompt_version text not null default 'v1',
  -- "flash" | "pro" — what the route asked for
  tier text not null default 'flash',
  -- "openai" | "gemini" — the engine that produced this attempt
  engine text not null,
  model text not null default '',
  -- "ok" | "error" (provider error, or reply failed to parse)
  status text not null default 'ok',
  error text not null default '',
  input_hash text not null default '',
  output_hash text not null default '',
  prompt_tokens integer,
  completion_tokens integer,
  latency_ms integer,
  -- staff email or id when a session was present, "system" for bots/cron
  requester text not null default 'system',
  -- what the human did with the draft; null until the UI reports back
  outcome text,
  outcome_at timestamptz,
  target_type text not null default '',
  target_id text not null default ''
);

create index if not exists ai_generations_tenant_created_idx
  on public.ai_generations (tenant_id, created_at desc);
create index if not exists ai_generations_route_idx
  on public.ai_generations (tenant_id, route, created_at desc);
create index if not exists ai_generations_requester_idx
  on public.ai_generations (tenant_id, requester, created_at desc);

comment on table public.ai_generations is
  'One row per LLM attempt by the server AI router: route, prompt version, tier, engine/model, hashes (no text), tokens, latency, requester, and the human outcome (accepted/edited/rejected) once known.';

grant all on public.ai_generations to service_role;

notify pgrst, 'reload schema';
