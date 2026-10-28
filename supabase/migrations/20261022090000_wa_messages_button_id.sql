/*
 * A tapped WhatsApp button, logged as what the person saw AND what it meant.
 *
 * The chat view (wa_messages) used to log a tap as the button's id — the
 * bots' menu ids read like "purpose_admission", not like anything a parent
 * tapped. From now the webhook logs the LABEL in `body` (kind 'button') and
 * keeps the machine value here: a reply button's id, or a template quick
 * reply's payload. The AI staff room's approval poller (automation/n8n)
 * reads either column, so "Approve 9" tapped under a draft decides draft 9.
 *
 * Additive. The webhook only writes button_id when there is one, so a
 * database that has not taken this migration still logs typed messages.
 */

alter table public.wa_messages
  add column if not exists button_id text not null default '';

comment on column public.wa_messages.button_id is
  'Inbound taps only: the reply button''s id or the template quick reply''s payload. body holds the label.';

notify pgrst, 'reload schema';
