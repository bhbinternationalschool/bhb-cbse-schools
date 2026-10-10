-- One send, one claim.
--
-- On 11 September 2026 this school's 146 fee-reminder families each
-- received the same message SEVEN times, 00:24-00:28 IST, seven distinct
-- Meta message ids apiece. Nobody did anything wrong: the approve route
-- read the card, saw "pending", spent ten seconds handing 146 recipients
-- to Meta, and only THEN wrote "dispatched". Seven impatient presses of
-- "Approve & send" all passed the same pending check, because the check
-- and the write were not the same act.
--
-- A jsonb blob cannot fix that. Read-modify-write on a document has no
-- point at which a second caller is refused; it only has a last writer.
-- So the claim lives here, as a primary key: the first INSERT wins and
-- every other caller gets a unique-violation, which is the whole point.
--
-- Rows are small and are kept: "who pressed send on this card, and when"
-- is the first question after an incident like the one above.

create table if not exists public.wa_send_claims (
  tenant_id uuid not null,
  -- Stable, caller-built key for the thing being sent exactly once,
  -- e.g. 'automation-approval:appr_9f3c'.
  claim_key text not null,
  claimed_at timestamptz not null default now(),
  claimed_by text not null default '',
  note text not null default '',
  primary key (tenant_id, claim_key)
);

alter table public.wa_send_claims enable row level security;

create policy wa_send_claims_tenant_all
  on public.wa_send_claims
  for all
  using (is_tenant_member(tenant_id));

comment on table public.wa_send_claims is
  'Send-once locks. First INSERT of (tenant_id, claim_key) may send; a unique violation means somebody else already is.';
