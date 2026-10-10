-- A student's own WhatsApp number, linked by their parent.
--
-- Study help arrived on WhatsApp household-scoped: the family's number
-- talks to the tutor. But the child doing the homework is often not holding
-- that phone, and in these families the parent's WhatsApp is the only app
-- the household has. So a student gets their own number — with the parent
-- granting it, and with a deliberately narrow scope.
--
-- What a linked student number may do: study help, nothing else. It cannot
-- see fee dues, receipts, pay links, the household record or the family's
-- message history, and it cannot buy a pass. That is not a limitation to
-- be relaxed later without thought — it is the reason this is safe to
-- switch on at all. A child's phone is lost, shared and borrowed more
-- often than a parent's, and none of the above should travel with it.
--
-- Consent runs one way: the PARENT asks for a code from their own
-- WhatsApp, and hands it to their child. The code is never sent to the
-- student's number, which is also the only workable design — Meta's
-- 24-hour window is closed for a number that has never messaged the
-- school, so we could not reach it first even if we wanted to.

create table if not exists public.wa_student_link_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  -- Hashed, like parent_otp_codes: a readable code sitting in a table is a
  -- way into a child's study help for anyone with database access.
  code_hash text not null,
  student_id text not null,
  household_id text not null,
  -- Who asked, for the audit trail: always a parent, from their own number.
  requested_by_mobile text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.wa_student_link_codes enable row level security;

create policy wa_student_link_codes_tenant_all
  on public.wa_student_link_codes
  for all
  using (is_tenant_member(tenant_id));

create index if not exists wa_student_link_codes_lookup_idx
  on public.wa_student_link_codes (tenant_id, expires_at)
  where used_at is null;

create table if not exists public.wa_student_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  -- E.164 digits, no plus. One number belongs to at most one student: a
  -- number answering as two children is a number that has to be asked
  -- "which of you is this", and there is no honest way to answer it.
  mobile_e164 text not null,
  student_id text not null,
  household_id text not null,
  linked_at timestamptz not null default now(),
  linked_by_mobile text not null,
  -- Unlinking keeps the row: "this number used to be Asha's" is worth
  -- knowing when the same handset turns up against another child.
  revoked_at timestamptz,
  revoked_by_mobile text,
  unique (tenant_id, mobile_e164)
);

alter table public.wa_student_links enable row level security;

create policy wa_student_links_tenant_all
  on public.wa_student_links
  for all
  using (is_tenant_member(tenant_id));

-- Every inbound message from an unknown number asks this table whether it
-- belongs to a student, so the live lookup is the one that must be fast.
create index if not exists wa_student_links_active_idx
  on public.wa_student_links (tenant_id, mobile_e164)
  where revoked_at is null;

create index if not exists wa_student_links_student_idx
  on public.wa_student_links (tenant_id, student_id)
  where revoked_at is null;
