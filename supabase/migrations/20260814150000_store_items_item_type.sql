-- Consumable-vs-durable classification for StoreItem — the last of three
-- gaps deferred from an earlier store-module round. Classification only:
-- doesn't restrict either allocation panel's item picker. Follows the same
-- `check (... in (...))` convention this table's own `audience` column
-- already uses.

alter table public.store_desk_items
  add column if not exists item_type text not null default 'consumable'
  check (item_type in ('consumable', 'durable'));
