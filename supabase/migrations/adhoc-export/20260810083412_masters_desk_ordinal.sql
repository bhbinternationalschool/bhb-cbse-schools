-- Preserve the slice's array order in the row tables.
--
-- The parity check showed every field value matching but the ARRAY ORDER
-- differing: the reader sorted by (sort_order, id) while the slice has
-- whatever order it was written in. That order is what staff see today —
-- lists render in array order — and while 29 call sites do sort by
-- sortOrder, plenty use .find() and nothing guarantees the rest sort.
--
-- Auditing every consumer of twenty collections to decide whether order
-- matters is a real audit, and guessing at it is how a "safe" switch quietly
-- reorders somebody's class list. Capturing the original position instead
-- makes the question moot: the reader can reproduce the slice byte for byte,
-- and any deliberate reordering becomes a separate, visible change.
--
-- `ordinal` is the array index in masters_desk_slices at copy time.

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('classes','masters_desk_classes'),('sections','masters_desk_sections'),
      ('campuses','masters_desk_campuses'),('academicYears','masters_desk_academic_years'),
      ('academicTerms','masters_desk_academic_terms'),('subjects','masters_desk_subjects'),
      ('classSubjects','masters_desk_class_subjects'),
      ('feeHeadCategories','masters_desk_fee_head_categories'),
      ('feeHeads','masters_desk_fee_heads'),('installments','masters_desk_installments'),
      ('feeGroups','masters_desk_fee_groups'),
      ('feeStructureLines','masters_desk_fee_structure_lines'),
      ('lateFeeRules','masters_desk_late_fee_rules'),('specialFees','masters_desk_special_fees'),
      ('specialFeeAssignments','masters_desk_special_fee_assignments'),
      ('concessionKinds','masters_desk_concession_kinds'),
      ('concessions','masters_desk_concessions'),
      ('concessionGrants','masters_desk_concession_grants'),
      ('seniorStreams','masters_desk_senior_streams'),
      ('numberSeries','masters_desk_number_series'),('holidays','masters_desk_holidays')
    ) as t(slice_key, tbl)
  loop
    execute format(
      'alter table public.%I add column if not exists ordinal integer not null default 0',
      r.tbl);

    execute format($f$
      update public.%I t
         set ordinal = src.idx
        from (
          select e->>'id' as id, (ord - 1)::int as idx
            from public.masters_desk_slices s,
                 jsonb_array_elements(s.payload) with ordinality as a(e, ord)
           where s.slice_key = %L
        ) src
       where t.id = src.id
    $f$, r.tbl, r.slice_key);
  end loop;
end $$;

-- The three single-document slices have no array order to preserve.
select 'ordinal captured' as step,
  (select count(*) from masters_desk_classes where ordinal >= 0) as classes,
  (select count(distinct ordinal) from masters_desk_fee_structure_lines) as fsl_distinct_ordinals,
  (select count(*) from masters_desk_fee_structure_lines) as fsl_rows;
