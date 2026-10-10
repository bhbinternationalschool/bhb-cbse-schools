-- masters_desk_special_fee_assignments was shaped from the wrong source.
--
-- The specialFeeAssignments slice holds ZERO rows, so 20260810030000 had no
-- field data to work from and took its columns (special_fee_id, student_id)
-- from the ABANDONED schema's table of the same name. The app's actual type
-- differs in kind, not just naming — an assignment targets a SET of classes
-- and/or students with an explicit scope, not a single student:
--
--   type SpecialFeeAssignment = {
--     id, specialFeeId, classIds: string[], studentIds: string[],
--     scope: "classes" | "students" | "mixed", createdAt
--   }
--
-- Caught by typecheck when the row reader tried to build the app's type from
-- the table. No data is affected — table and slice are both empty — but the
-- shape had to be right before anything writes to it. A good argument for
-- deriving schema from the app's types rather than from whatever table
-- happens to share the name.
--
-- student_id is left in place, unused: additive migrations stay the rule
-- until Stage 10.

alter table public.masters_desk_special_fee_assignments
  add column if not exists class_ids   jsonb not null default '[]'::jsonb,
  add column if not exists student_ids jsonb not null default '[]'::jsonb,
  add column if not exists scope       text,
  add column if not exists created_at  timestamptz not null default now();

comment on column public.masters_desk_special_fee_assignments.student_id is
  'Unused. Left from the initial shape, inferred from the abandoned schema because the source slice was empty. Superseded by student_ids.';
