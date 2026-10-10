-- Link StoreAssetAllocation to the StoreInfraLevel master, same as
-- store_desk_inventory_allocations.infra_level_id already does. The
-- existing free-text `location` column is kept as-is (not dropped) — it
-- stays as an optional sub-detail within the linked infra level, so no
-- existing asset-allocation row needs a backfill decision.

alter table public.store_desk_asset_allocations
  add column if not exists infra_level_id text not null default '';
