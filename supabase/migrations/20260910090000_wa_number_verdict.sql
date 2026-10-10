-- Is this parent's number actually on WhatsApp?
--
-- The school had ten parent numbers that are not WhatsApp users and no way
-- to know it. Meta says so clearly — error 131026, "Message undeliverable"
-- — but only once per failed send, buried in `wa_message_delivery` next to
-- 131047 ("Re-engagement message"), which looks similar and means the
-- opposite: the number is fine, we just sent free text too late.
--
-- So the verdict gets a home, on the row that already answers the other
-- per-number question (has this family replied STOP). Two sources write it:
--
--   * `send_failure`  — observed. A 131026 came back, so we know.
--   * `contacts_api`  — asked. Meta's /contacts lookup, run over the roster
--                       before a big send rather than learning during one.
--
-- NULL means never established, which is not the same as "on WhatsApp" and
-- must never be rendered as either. A number nobody has checked is simply
-- unchecked.

alter table public.wa_contact_state
  add column if not exists on_whatsapp boolean,
  add column if not exists wa_checked_at timestamptz,
  add column if not exists wa_check_source text;

comment on column public.wa_contact_state.on_whatsapp is
  'true = confirmed WhatsApp user, false = confirmed not, NULL = never checked (never treat NULL as either).';
comment on column public.wa_contact_state.wa_check_source is
  'How on_whatsapp was established: contacts_api (asked Meta) or send_failure (observed a 131026).';

-- The roster check and the bad-numbers list both read "the numbers we know
-- are not on WhatsApp", so index that answer rather than scanning.
create index if not exists wa_contact_state_on_whatsapp_idx
  on public.wa_contact_state (tenant_id, on_whatsapp)
  where on_whatsapp is not null;
