-- UPI payments the school made, with the UTR read off the payer's success
-- screenshot (director, 7 Oct 2026: "pay by GPay from the ERP" and "share the
-- screenshot on the school WhatsApp number to auto-fill the UTR").
--
-- Kept in its own server table, not on the payroll line or advance it pays:
-- those live in the browser-synced desks (payroll-desk, the staff_advances
-- slice), whose pushes replace rows whole with no revision guard, so a UTR
-- written there by the server could be erased by any office browser holding
-- an older copy. Ledger lines are append-only. This table is written only by
-- the server.
--
-- status 'pending' = read from a WhatsApp screenshot and waiting for the
-- sender to confirm which payment it is; 'recorded' = confirmed (or recorded
-- from the ERP's own Pay by UPI button); 'dismissed' = the sender said no.
-- A UTR is recorded once per school, whichever way it came in.

create table if not exists public.upi_payment_proofs (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  status text not null check (status in ('pending', 'recorded', 'dismissed')),
  utr text not null check (utr ~ '^[0-9]{12}$'),
  amount_paise bigint not null check (amount_paise > 0),
  paid_on date,
  payee_name text not null default '',
  payee_vpa text not null default '',
  -- What it pays, once known: payroll_line ("<runId>|<staffId>"),
  -- staff_advance (advance id), ledger_voucher (voucher id).
  target_kind text check (target_kind in ('payroll_line', 'staff_advance', 'ledger_voucher')),
  target_id text,
  target_label text not null default '',
  -- The candidates offered on WhatsApp, in button order: [{kind,targetId,label}]
  candidates jsonb not null default '[]'::jsonb,
  source text not null check (source in ('whatsapp', 'erp')),
  sender_mobile text not null default '',
  sender_staff_id text not null default '',
  wa_message_id text not null default '',
  recorded_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One recording per UTR, and one UTR per paid item.
create unique index if not exists upi_payment_proofs_utr_recorded
  on public.upi_payment_proofs (tenant_id, utr) where status = 'recorded';
create unique index if not exists upi_payment_proofs_target_recorded
  on public.upi_payment_proofs (tenant_id, target_kind, target_id) where status = 'recorded';
create index if not exists upi_payment_proofs_target_idx
  on public.upi_payment_proofs (tenant_id, target_kind, target_id);

alter table public.upi_payment_proofs enable row level security;

-- Every new table needs an explicit service_role grant, or the server's
-- writes fail silently with 42501 (memory: erp-supabase-new-table-grant).
grant all on public.upi_payment_proofs to service_role;
