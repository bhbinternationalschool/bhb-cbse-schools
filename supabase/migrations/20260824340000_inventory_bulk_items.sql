-- Create the catalogue from a pasted sheet, not one form at a time.
--
-- A school store holds hundreds of lines — every class's books, every size of
-- uniform, stationery, lab consumables. Entering them singly is why the
-- catalogue currently holds twenty items and the store cannot really open.
-- The list already exists, in the supplier's quotation or last year's sheet,
-- so the job is to accept it rather than to re-type it.
--
-- Three things make this safe to hand to an office:
--
--   * It is IDEMPOTENT on the SKU. Somebody will paste the same sheet twice —
--     after a browser crash, or because they were not sure it worked. The
--     second paste updates the same rows instead of creating a shadow
--     catalogue with every item duplicated, which is the failure that would
--     make stock counts meaningless.
--
--   * It VALIDATES EVERYTHING BEFORE WRITING ANYTHING. A three-hundred-row
--     paste with a bad GST rate on row 47 reports row 47 and writes nothing,
--     rather than leaving 46 items in and the operator guessing where it
--     stopped. `dry_run` runs the same validation and returns the same report
--     without writing at all, so the screen can show what WILL happen and the
--     clerk confirms a result they have already seen.
--
--   * Categories and units are matched BY NAME and created when missing.
--     Requiring the masters to exist first would mean three imports in a fixed
--     order, and getting that order wrong is exactly the kind of setup mistake
--     that ends with a half-built catalogue.
--
-- Duplicate SKUs WITHIN one paste are an error, not a last-one-wins merge:
-- two rows claiming one code means the sheet is wrong, and silently keeping
-- the second would hide it.

create or replace function public.inv_bulk_upsert_items(
  p_tenant_id uuid,
  p_actor text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb := coalesce(p_payload->'rows', '[]'::jsonb);
  v_dry boolean := coalesce((p_payload->>'dry_run')::boolean, true);
  v_price_list uuid := nullif(p_payload->>'price_list_id', '')::uuid;
  v_row jsonb;
  v_i int := 0;
  v_report jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_errors int := 0;
  v_creates int := 0;
  v_updates int := 0;
  v_sku text;
  v_name text;
  v_gst numeric;
  v_reorder numeric;
  v_mrp bigint;
  v_sale bigint;
  v_maxdisc numeric;
  v_kind text;
  v_err text;
  v_existing uuid;
  v_action text;
  v_cat uuid;
  v_uom uuid;
  v_item_id uuid;
  v_has_price boolean;
begin
  if jsonb_array_length(v_rows) = 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Nothing to import — the sheet had no rows',
      'summary', jsonb_build_object('create', 0, 'update', 0, 'error', 0),
      'rows', '[]'::jsonb
    );
  end if;

  if jsonb_array_length(v_rows) > 2000 then
    raise exception 'That is % rows. Import 2000 at a time so a mistake stays small',
      jsonb_array_length(v_rows);
  end if;

  -- A price list is only needed if some row actually carries a price.
  v_has_price := exists (
    select 1 from jsonb_array_elements(v_rows) r
     where coalesce((r->>'sale_paise')::bigint, 0) > 0
        or coalesce((r->>'mrp_paise')::bigint, 0) > 0
  );
  if v_has_price and v_price_list is null then
    select id into v_price_list
      from public.inv_price_lists
     where tenant_id = p_tenant_id and is_default and is_active
     order by created_at
     limit 1;
  end if;

  /* ─── Pass 1: validate every row, write nothing ──────────── */

  for v_row in select * from jsonb_array_elements(v_rows)
  loop
    v_i := v_i + 1;
    v_err := '';

    v_name := btrim(coalesce(v_row->>'name', ''));
    v_sku  := upper(btrim(coalesce(v_row->>'sku', '')));
    v_kind := lower(btrim(coalesce(nullif(v_row->>'item_kind', ''), 'consumable')));

    if v_name = '' then
      v_err := 'Name is required';
    elsif v_sku = '' then
      -- A blank SKU is allowed on the single-item form, which derives one.
      -- In a sheet it is almost always a stray blank line or a shifted column,
      -- and inventing codes for hundreds of rows makes the result unusable.
      v_err := 'SKU is required when importing a sheet';
    elsif v_kind not in ('consumable', 'asset') then
      v_err := format('Kind must be consumable or asset, not "%s"', v_kind);
    elsif v_sku = any(v_seen) then
      v_err := format('SKU %s appears more than once in this sheet', v_sku);
    end if;

    if v_err = '' then
      begin
        v_gst := coalesce((v_row->>'gst_rate')::numeric, 0);
        if v_gst < 0 or v_gst > 100 then
          v_err := format('GST rate %s is not between 0 and 100', v_gst);
        end if;
      exception when others then
        v_err := format('GST rate "%s" is not a number', v_row->>'gst_rate');
      end;
    end if;

    if v_err = '' then
      begin
        v_reorder := coalesce((v_row->>'reorder_level')::numeric, 0);
        v_mrp     := coalesce((v_row->>'mrp_paise')::bigint, 0);
        v_sale    := coalesce((v_row->>'sale_paise')::bigint, 0);
        v_maxdisc := coalesce((v_row->>'max_discount_pct')::numeric, 0);
        if v_reorder < 0 then v_err := 'Reorder level cannot be negative';
        elsif v_mrp < 0 or v_sale < 0 then v_err := 'Prices cannot be negative';
        elsif v_maxdisc < 0 or v_maxdisc > 100 then
          v_err := format('Max discount %s is not between 0 and 100', v_maxdisc);
        end if;
      exception when others then
        v_err := 'A number in this row could not be read';
      end;
    end if;

    -- Priced rows with nowhere to put the price would import silently without
    -- the sale price, which is the one thing the counter needs.
    if v_err = ''
       and (coalesce((v_row->>'sale_paise')::bigint, 0) > 0
            or coalesce((v_row->>'mrp_paise')::bigint, 0) > 0)
       and v_price_list is null then
      v_err := 'This row has a price but there is no default price list to put it on';
    end if;

    v_action := 'error';
    if v_err = '' then
      v_seen := v_seen || v_sku;
      select id into v_existing
        from public.inv_items
       where tenant_id = p_tenant_id and lower(sku) = lower(v_sku);
      if v_existing is null then
        v_action := 'create';
        v_creates := v_creates + 1;
      else
        v_action := 'update';
        v_updates := v_updates + 1;
      end if;
    else
      v_errors := v_errors + 1;
    end if;

    v_report := v_report || jsonb_build_object(
      'row', v_i,
      'sku', v_sku,
      'name', v_name,
      'action', v_action,
      'error', v_err
    );
  end loop;

  -- Nothing is written unless every row is sound. A partial catalogue is
  -- worse than none: the operator cannot tell what landed.
  if v_errors > 0 or v_dry then
    return jsonb_build_object(
      'ok', v_errors = 0,
      'applied', false,
      'error', case when v_errors > 0
                    then format('%s row(s) need fixing before anything is imported', v_errors)
                    else '' end,
      'summary', jsonb_build_object('create', v_creates, 'update', v_updates, 'error', v_errors),
      'rows', v_report
    );
  end if;

  /* ─── Pass 2: write ──────────────────────────────────────── */

  for v_row in select * from jsonb_array_elements(v_rows)
  loop
    v_name := btrim(v_row->>'name');
    v_sku  := upper(btrim(v_row->>'sku'));
    v_kind := lower(coalesce(nullif(v_row->>'item_kind', ''), 'consumable'));

    v_cat := null;
    if btrim(coalesce(v_row->>'category', '')) <> '' then
      select id into v_cat from public.inv_categories
       where tenant_id = p_tenant_id
         and lower(name) = lower(btrim(v_row->>'category'));
      if v_cat is null then
        insert into public.inv_categories (tenant_id, name, kind)
        values (p_tenant_id, btrim(v_row->>'category'),
                case when v_kind = 'asset' then 'asset' else 'consumable' end)
        returning id into v_cat;
      end if;
    end if;

    v_uom := null;
    if btrim(coalesce(v_row->>'uom', '')) <> '' then
      select id into v_uom from public.inv_uoms
       where tenant_id = p_tenant_id
         and lower(name) = lower(btrim(v_row->>'uom'));
      if v_uom is null then
        insert into public.inv_uoms (tenant_id, name)
        values (p_tenant_id, btrim(v_row->>'uom'))
        returning id into v_uom;
      end if;
    end if;

    insert into public.inv_items (
      tenant_id, sku, name, category_id, uom_id, item_kind,
      hsn_code, gst_rate, reorder_level, barcode, notes, created_by
    ) values (
      p_tenant_id, v_sku, v_name, v_cat, v_uom, v_kind,
      coalesce(v_row->>'hsn_code', ''),
      coalesce((v_row->>'gst_rate')::numeric, 0),
      coalesce((v_row->>'reorder_level')::numeric, 0),
      coalesce(v_row->>'barcode', ''),
      coalesce(v_row->>'notes', ''),
      p_actor
    )
    on conflict (tenant_id, lower(sku)) do update
      set name          = excluded.name,
          category_id   = coalesce(excluded.category_id, public.inv_items.category_id),
          uom_id        = coalesce(excluded.uom_id, public.inv_items.uom_id),
          item_kind     = excluded.item_kind,
          hsn_code      = excluded.hsn_code,
          gst_rate      = excluded.gst_rate,
          reorder_level = excluded.reorder_level,
          barcode       = excluded.barcode,
          notes         = excluded.notes,
          updated_at    = now()
    returning id into v_item_id;

    v_mrp  := coalesce((v_row->>'mrp_paise')::bigint, 0);
    v_sale := coalesce((v_row->>'sale_paise')::bigint, 0);
    if v_price_list is not null and (v_mrp > 0 or v_sale > 0) then
      insert into public.inv_price_list_items (
        tenant_id, price_list_id, item_id, mrp_paise, sale_paise, max_discount_pct
      ) values (
        p_tenant_id, v_price_list, v_item_id,
        v_mrp,
        case when v_sale > 0 then v_sale else v_mrp end,
        coalesce((v_row->>'max_discount_pct')::numeric, 0)
      )
      on conflict (tenant_id, price_list_id, item_id) do update
        set mrp_paise       = excluded.mrp_paise,
            sale_paise      = excluded.sale_paise,
            max_discount_pct = excluded.max_discount_pct,
            updated_at      = now();
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'applied', true,
    'error', '',
    'summary', jsonb_build_object('create', v_creates, 'update', v_updates, 'error', 0),
    'rows', v_report
  );
end;
$$;

grant execute on function public.inv_bulk_upsert_items(uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';
