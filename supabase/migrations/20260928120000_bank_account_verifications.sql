-- Bank accounts the school has verified before paying them.
--
-- Nothing in the ERP checked an account before money went to it. A staff
-- member's account number is typed into Masters once and used every month
-- afterwards; a wrong digit surfaces as ₹40,000 gone to a stranger, and the
-- bank will not reverse it. A penny drop asks "does this account exist, and
-- whose name is on it" for ₹1.
--
-- WHY A TABLE. Two reasons, and the second matters more than it looks.
--
-- Every verification costs money. Without a cache, opening a staff record
-- twice bills the school twice, and a list of thirty staff would bill thirty
-- times on every page load. So a result is stored against a fingerprint of
-- what was verified and reused.
--
-- And the answer has to OUTLIVE the check, because the answer is the evidence.
-- "This account was verified on 28 Sep and the bank said it belongs to Kamlesh
-- Kumar" is what an auditor asks for, and what the office needs when a payment
-- is later disputed. A check whose result is thrown away has to be bought again
-- to prove anything.
--
-- WHAT IS DELIBERATELY NOT HERE: the account number. The fingerprint is a
-- SHA-256 of account|IFSC, and only the last four digits are kept for a human
-- to recognise the row. A verification table that quietly became a second copy
-- of every staff member's bank details would be a worse problem than the one it
-- was built to solve — and unlike Masters, this table has no reason to hold
-- them, because a fingerprint is all a cache lookup needs.

create table if not exists public.bank_account_verifications (
  -- SHA-256 of "<account>|<IFSC>", both stripped and upper-cased. The PAIR:
  -- a changed IFSC is a different account and must not hit a cached answer.
  fingerprint text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- For a human to recognise the row. Never the full number.
  account_last4 text not null default '',
  ifsc text not null default '',
  -- VALID | INVALID | RECEIVED | FAILED, as the reader maps them. Anything
  -- Cashfree has not documented as conclusive is stored as FAILED, never VALID.
  status text not null,
  -- The name the BANK holds. The whole value of the check: an account that
  -- exists but belongs to somebody else is the failure this catches.
  name_at_bank text not null default '',
  -- The name the school held when it asked, so a later rename is visible as a
  -- reason to re-verify rather than silently making an old result look wrong.
  expected_name text not null default '',
  name_match_score integer,
  -- ok | name_mismatch | unnamed | invalid | unknown.
  verdict text not null default 'unknown',
  reference text not null default '',
  message text not null default '',
  -- Which record this was verified for, so the staff or vendor screen can show
  -- it. Free-form because the same account may be checked from either.
  subject_kind text not null default '',
  subject_id text not null default '',
  verified_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.bank_account_verifications is
  'Penny-drop results, keyed by a hash of account+IFSC. Holds no account numbers — only the last four digits. Cached because each verification is billed, and kept because the result is the evidence.';

create index if not exists bank_account_verifications_subject_idx
  on public.bank_account_verifications (tenant_id, subject_kind, subject_id);

-- The accounts a person should look at: exists but in another name, or the
-- bank said no. Partial so it stays small — the rows that matter are the few
-- that failed, not every account ever checked.
create index if not exists bank_account_verifications_attention_idx
  on public.bank_account_verifications (tenant_id, verdict)
  where verdict in ('name_mismatch', 'invalid');

-- Every new table needs an explicit service_role grant, or the server's writes
-- fail 42501 and the request "succeeds" while storing nothing. Here that would
-- mean paying for a verification and keeping no record of it — so the school
-- would be billed again for the same check, for ever.
grant all on public.bank_account_verifications to service_role;
-- Server-only, like fee_autopay: no anon/authenticated access and RLS on,
-- so the public key cannot read money records through PostgREST.
revoke all on public.bank_account_verifications from anon, authenticated;
alter table public.bank_account_verifications enable row level security;

notify pgrst, 'reload schema';
