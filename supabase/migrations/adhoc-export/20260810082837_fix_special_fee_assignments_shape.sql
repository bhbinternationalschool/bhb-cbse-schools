-- masters_desk_special_fee_assignments was shaped from the wrong source.
--
-- The specialFeeAssignments slice holds ZERO rows, so 20260810030000 had no
-- field data to work from and took its columns (special_fee_id, student_id)
-- from the abandoned schema's table of the same name. The app's actual type
-- is different in kind, not just in naming — an assignment targets a SET of
-- classes and/or students with an explicit scope, not one student:
--
--   type SpecialFeeAssignment = {
--     id, specialFeeId, classIds: string[], studentIds: string[],
--     scope: "classes" | "students" | "mixed", createdAt
--   }
--
-- Caught by typecheck when the reader tried to build the app's type from the
-- table. No data is affected — the table and the slice are both empty — but
-- the shape had to be corrected before anything writes to it.
--
-- Left in place rather than dropped: student_id is unused and additive
-- migrations stay the rule until Stage 10.

alter table public.masters_desk_special_fee_assignments
  add column if not exists class_ids   jsonb not null default '[]'::jsonb,
  add column if not exists student_ids jsonb not null default '[]'::jsonb,
  add column if not exists scope       text,
  add column if not exists created_at  timestamptz not null default now();

comment on column public.masters_desk_special_fee_assignments.student_id is
  'Unused. Left from the initial shape, which was inferred from the abandoned schema because the source slice was empty. Superseded by student_ids.';
