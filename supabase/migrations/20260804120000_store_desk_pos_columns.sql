-- Store desk: vendor link, sale-group class scope, POS payment fields

alter table public.store_desk_categories
  add column if not exists preferred_source_ids jsonb not null default '[]'::jsonb;

alter table public.store_desk_sale_groups
  add column if not exists category_id text not null default '',
  add column if not exists class_ids jsonb not null default '[]'::jsonb;

alter table public.store_desk_sources
  add column if not exists accounts_vendor_id text not null default '';

alter table public.store_desk_issues
  add column if not exists tender_mode text not null default 'cash',
  add column if not exists payment_channel text not null default '',
  add column if not exists counter_paid_paise bigint not null default 0,
  add column if not exists stock_group_id text not null default '',
  add column if not exists sale_group_id text not null default '';
