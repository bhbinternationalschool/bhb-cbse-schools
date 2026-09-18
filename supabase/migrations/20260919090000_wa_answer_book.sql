-- The school's answer book: what the office says, so the bot can say it again.
--
-- WHY (director, 19 Sep 2026): "can we put AI model in our whatsapp chat that
-- automatically train our AI for future answer from current fallback".
--
-- The honest shape of that is not a fine-tuned model. A school's answers are
-- facts that change on the day a committee changes them — a fee, a timing, a
-- rule — and weights cannot be corrected on that day, nor can they be shown
-- to the person who has to stand behind the answer. So the answer is stored
-- as words the school owns, embedded for retrieval, and quoted back by the
-- model rather than invented by it. The same no-invention rule the rest of
-- this ERP's AI follows.
--
-- Two states matter. A PROPOSED entry is what a parent asked and what the
-- office said in reply — captured automatically, and it answers NOBODY. An
-- APPROVED entry has been read and passed by someone with the authority to
-- speak for the school, and only then is it embedded into school_kb_chunks,
-- which the parent bot already searches. Approval is the whole safety story:
-- without it, one hurried WhatsApp reply becomes the school's official
-- position on fees, forever, to everyone who asks.

create table if not exists public.wa_answer_book (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  id uuid not null default gen_random_uuid(),

  -- The question in the words a parent would use. Other phrasings live in
  -- `variants` so one answer can be found by several askings.
  question text not null,
  variants text[] not null default '{}',
  -- The school's own words. Empty while a question is still waiting.
  answer text not null default '',
  -- 'hi' | 'en' | 'both' — which language this wording is for.
  language text not null default 'both' check (language in ('hi', 'en', 'both')),
  -- fees, transport, admissions, exams, timings, general…
  category text not null default 'general',

  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'retired')),
  -- Where it came from: an office reply on WhatsApp, a question nobody could
  -- answer, or written straight into the desk.
  source text not null default 'written'
    check (source in ('office_reply', 'unanswered', 'written')),
  -- The relay message / thread this was learned from, for reading back.
  source_ref text not null default '',

  -- A fact that is only true this year says so, and stops answering after.
  -- An answer that has quietly expired is worse than no answer: the parent
  -- believes it ([[erp-unknown-must-not-become-fact]]).
  valid_until date,

  asked_count integer not null default 1,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  approved_by text not null default '',
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

create index if not exists wa_answer_book_status_idx
  on public.wa_answer_book (tenant_id, status, updated_at desc);

create index if not exists wa_answer_book_category_idx
  on public.wa_answer_book (tenant_id, category);

alter table public.wa_answer_book enable row level security;

-- A new table gets no grants by default and every write fails 42501 in
-- silence ([[erp-supabase-new-table-grant]]).
grant all on public.wa_answer_book to service_role;
