-- A parent flagging an AI tutor reply as wrong, unsafe or offensive.
--
-- Google Play's generative-AI policy requires an in-app way to report
-- offensive AI output and requires the developer to act on what is
-- reported. The school wants this regardless: the tutor speaks to children
-- in the school's name, and until now a parent who got a bad answer had
-- nowhere to say so.
--
-- This table deliberately stores the TEXT of the question and the reply,
-- which ai_generations never does — that table keeps only sha256 hashes,
-- because prompts carry student facts. A report cannot be acted on without
-- reading what was actually said. The text kept here is scoped to the one
-- exchange a parent objected to, and it dies with the report.

create table if not exists public.ai_content_reports (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Links to ai_generations when the client knew the id; '' when it did
  -- not. Never required: a report must survive a client that lost it.
  generation_id text not null default '',
  route text not null default 'tutor',
  household_id text not null default '',
  student_id text not null default '',
  reported_by text not null default '',
  reason text not null default '',
  question text not null default '',
  reply text not null default '',
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text not null default '',
  review_note text not null default ''
);

-- The queue the school works from: open reports, newest first.
create index if not exists ai_content_reports_open_idx
  on public.ai_content_reports (tenant_id, created_at desc)
  where status = 'open';
create index if not exists ai_content_reports_generation_idx
  on public.ai_content_reports (tenant_id, generation_id)
  where generation_id <> '';

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail 42501 and the request "succeeds" while storing nothing.
grant all on public.ai_content_reports to service_role;

notify pgrst, 'reload schema';
