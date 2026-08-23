-- Admissions → Village market: the block list, as a set-returning function.
--
-- WHY: the dashboard's block picker was built on
--   select block_name from village_demographics
-- and then de-duplicated in TypeScript. PostgREST caps an unbounded select at
-- 1,000 rows, and Varanasi seeds 1,258 villages — so the last block off the
-- end of the page (Sevapuri, 177 villages) silently vanished from the picker
-- and the office could not select the block at all.
--
-- Doing the DISTINCT in Postgres returns 8 rows instead of 1,258 and cannot
-- be truncated by a row cap that has nothing to do with how many blocks exist.

create or replace function public.village_blocks(p_tenant_id uuid)
returns table (
  block_name text,
  village_count bigint,
  projected_child_pop bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    d.block_name,
    count(*)::bigint as village_count,
    sum(d.estimated_current_child_pop)::bigint as projected_child_pop
  from public.village_demographics d
  where d.tenant_id = p_tenant_id
    and btrim(d.block_name) <> ''
  group by d.block_name
  order by d.block_name;
$$;

comment on function public.village_blocks(uuid) is
  'Distinct blocks with village counts and projected 0-6 pools. Replaces a client-side DISTINCT over every village row, which PostgREST truncated at 1,000 rows and so lost whole blocks.';

revoke all on function public.village_blocks(uuid) from public;
grant execute on function public.village_blocks(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
