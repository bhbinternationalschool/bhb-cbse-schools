-- Inventory & Procurement — Phase 5: drop the legacy store and purchase tables.
--
-- These backed the browser-held Store and Purchase modules that the inv_*
-- module replaced. They are being dropped rather than archived in place
-- because they hold essentially nothing and never did: on 2026-08-23 every
-- store_desk_* table had zero rows while the app treated them as truth, which
-- is the bug the rebuild exists to fix. The store_state blob likewise holds
-- zero items.
--
-- What little they contain (2 indents, 3 indent lines, a settings row, and the
-- two state blobs) was exported to backups/legacy-store-purchase/ before this
-- ran, and the ERP owner confirmed the data is expendable. The application
-- code that read these tables was deleted in the same change, so nothing is
-- left pointing at them.
--
-- Note the older store_items / store_issues / purchase_orders generation is
-- dropped too — superseded by the *_desk_* tables long before this rebuild and
-- empty ever since.

drop table if exists public.store_desk_sell_return_lines cascade;
drop table if exists public.store_desk_sell_returns cascade;
drop table if exists public.store_desk_issue_lines cascade;
drop table if exists public.store_desk_issues cascade;
drop table if exists public.store_desk_movements cascade;
drop table if exists public.store_desk_inventory_allocations cascade;
drop table if exists public.store_desk_asset_allocations cascade;
drop table if exists public.store_desk_items cascade;
drop table if exists public.store_desk_sale_groups cascade;
drop table if exists public.store_desk_categories cascade;
drop table if exists public.store_desk_uoms cascade;
drop table if exists public.store_desk_infra_levels cascade;
drop table if exists public.store_desk_sources cascade;
drop table if exists public.store_desk_sync_meta cascade;
drop table if exists public.store_state cascade;

-- Pre-desk generation.
drop table if exists public.store_issue_lines cascade;
drop table if exists public.store_issues cascade;
drop table if exists public.store_items cascade;

drop table if exists public.purchase_desk_return_lines cascade;
drop table if exists public.purchase_desk_returns cascade;
drop table if exists public.purchase_desk_grn_lines cascade;
drop table if exists public.purchase_desk_grns cascade;
drop table if exists public.purchase_desk_order_lines cascade;
drop table if exists public.purchase_desk_orders cascade;
drop table if exists public.purchase_desk_indent_lines cascade;
drop table if exists public.purchase_desk_indents cascade;
drop table if exists public.purchase_desk_settings cascade;
drop table if exists public.purchase_desk_sync_meta cascade;
drop table if exists public.purchase_state cascade;

-- Pre-desk generation.
drop table if exists public.purchase_grn_lines cascade;
drop table if exists public.purchase_grns cascade;
drop table if exists public.purchase_order_lines cascade;
drop table if exists public.purchase_orders cascade;
drop table if exists public.purchase_indent_lines cascade;
drop table if exists public.purchase_indents cascade;

notify pgrst, 'reload schema';
