/*
 * Masters saved section by section (director, 10 Oct 2026 — storage plan,
 * Phase 2).
 *
 * Masters had one version for the whole book: a holiday edit on one PC made
 * a concession saved on another a moment later "stale", and every save
 * rewrote every section. Now a browser sends only the sections it changed,
 * each with the `updated_at` it loaded that section at. This function writes
 * them ALL or NONE: each named slice row is locked, every base is checked,
 * and only if all still match are they written (one transaction). Sections
 * depend on each other (classes, sections, subjects, class links), so a
 * half-landed save is never possible.
 *
 * A base of '' means "a section this browser saw as absent": it lands only
 * if the section still does not exist.
 *
 * The desk revision (masters_desk_sync_meta.updated_at) still moves with
 * every write, so a browser from an older build — which saves the whole book
 * against that revision — is refused and reloads rather than overwriting.
 */

create or replace function public.masters_write_slices(
  p_tenant_id uuid,
  p_slices jsonb,       -- [{ "key": text, "payload": jsonb, "base": text }]
  p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_key text;
  v_base text;
  v_stored timestamptz;
  v_found boolean;
  v_conflicts text[] := '{}';
begin
  if jsonb_typeof(p_slices) <> 'array' or jsonb_array_length(p_slices) = 0 then
    return jsonb_build_object('ok', false, 'error', 'No sections to save');
  end if;

  -- Lock every named section first, in key order (no deadlock between two
  -- saves naming the same sections), then check every base.
  perform 1 from public.masters_desk_slices
   where tenant_id = p_tenant_id
     and slice_key in (select x->>'key' from jsonb_array_elements(p_slices) x)
   order by slice_key
   for update;

  for v_item in select * from jsonb_array_elements(p_slices) loop
    v_key := v_item->>'key';
    v_base := coalesce(v_item->>'base', '');
    select updated_at, true into v_stored, v_found
      from public.masters_desk_slices
     where tenant_id = p_tenant_id and slice_key = v_key;
    if v_found is null then v_found := false; end if;

    if v_base = '' then
      if v_found then v_conflicts := v_conflicts || v_key; end if;
    elsif not v_found or v_stored <> v_base::timestamptz then
      v_conflicts := v_conflicts || v_key;
    end if;
    v_found := null;
  end loop;

  if array_length(v_conflicts, 1) > 0 then
    return jsonb_build_object('ok', false, 'conflicts', to_jsonb(v_conflicts));
  end if;

  insert into public.masters_desk_slices (tenant_id, slice_key, payload, updated_at)
  select p_tenant_id, x->>'key', x->'payload', p_now
    from jsonb_array_elements(p_slices) x
  on conflict (tenant_id, slice_key)
  do update set payload = excluded.payload, updated_at = excluded.updated_at;

  insert into public.masters_desk_sync_meta (tenant_id, updated_at, last_updated_at)
  values (p_tenant_id, p_now, p_now)
  on conflict (tenant_id)
  do update set updated_at = excluded.updated_at, last_updated_at = excluded.last_updated_at;

  return jsonb_build_object('ok', true, 'updated_at', p_now);
end;
$$;

revoke all on function public.masters_write_slices(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.masters_write_slices(uuid, jsonb, timestamptz) to service_role;

notify pgrst, 'reload schema';
