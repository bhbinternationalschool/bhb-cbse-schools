-- Meta's own word on whether each message was charged.
--
-- Every status webhook (sent / delivered / read) carries a `pricing` block:
--   billable  true | false
--   category  marketing | utility | authentication | service | …
--   type      regular | free_customer_service | free_entry_point
-- A utility template sent inside an open 24-hour window, and every free-form
-- reply, come back billable = false. Storing it lets the cost report price
-- each message the way Meta's invoice does, instead of guessing from the
-- template's category.
--
-- Nullable: rows from before this column existed, and failed messages (which
-- carry no pricing), stay null and are estimated as before.

alter table wa_message_delivery
  add column if not exists billable boolean,
  add column if not exists pricing_category text,
  add column if not exists pricing_type text;

-- The monthly bill reads "billable rows in a month" — keep that an index scan.
create index if not exists wa_message_delivery_tenant_event_priced_idx
  on wa_message_delivery (tenant_id, event_at)
  where billable is not null;
