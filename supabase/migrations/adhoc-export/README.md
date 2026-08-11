# Ad-hoc migrations, recovered from the database

These 23 migrations were applied straight to production through the Supabase
MCP tool during the 2026-08-09 → 2026-08-11 incident response. They were
recorded in `supabase_migrations.schema_migrations` but **never existed as
files**, so the repository could not show what production actually ran.

Exported 2026-08-11 from `schema_migrations.statements`, verbatim.

## Why this matters

On 2026-08-11 an audit found 879 admission leads had lost `address`,
`locality`, `motherName`, `whatsapp`, `campaignNote`, `createdBy` and `note`.
The data was recoverable only because one of these migrations happened to
snapshot the table first (`admission_desk_leads_pre_snapshotrepair_20260809`).

Finding the cause meant reading SQL that existed nowhere but the database.
That is the reason for this directory.

The same drift hid a different bug two days earlier:
`20260808150000_sis_push_guarded_stable_versions` was recorded as applied, the
repo file showed a no-op skip, and the function in the database had none — the
file had been edited after it ran. Every review of the repo looked correct
while production behaved differently. **`schema_migrations` is not evidence
that the deployed code matches the repo.** Verify with `pg_get_functiondef`.

## What these do NOT explain

None of them stripped the 879 leads. Both that touch admissions —
`recover_admission_lead_classes` and `repair_ids_from_mirror_snapshot` — use
`jsonb_set` / `||`, which merge named keys and preserve every other field, and
both set `updated_at = now()`. The damaged rows still read `updated_at =
2026-07-18`, so neither ran against them.

That leaves one candidate: **a bare `execute_sql` statement**, which is not
recorded anywhere at all. Migrations applied through the MCP tool at least
store their SQL; ad-hoc queries leave no trace — no version, no statements, no
timestamp. The damage is real, dated between 2026-08-09 and 2026-08-11, and
untraceable from inside the database.

## Rules this argues for

1. **Repairs go in a migration file, in the repo, before they are applied.**
   Not afterwards, and not as a bare query.
2. **Snapshot before repairing.** `_pre_snapshotrepair_20260809` is the only
   reason 919 leads were recoverable.
3. **Assert the expected end state inside the transaction** and let it roll
   itself back on mismatch, rather than checking afterwards.
4. **`execute_sql` is for reading.** A write through it is invisible to every
   future investigation, including one trying to undo it.

## Reconciling with the numbered migrations

Several of these duplicate a repo file under a different version — the file
was written after the fact, so the repo and the database disagree on the
version number while holding the same SQL. Known pairs:

| database version | repo file |
|---|---|
| `20260810102500_sis_push_guarded_statement_timeout` | `20260810090000_…` |
| `20260810104449_sis_push_guarded_restore_noop_skip` | `20260810110000_…` |
| `20260809044047_sis_push_guarded_stable_versions` | `20260808150000_…` (edited after applying) |

They are idempotent, so this is bookkeeping rather than a live hazard — but
reconcile it before it meets a migration that is not.
