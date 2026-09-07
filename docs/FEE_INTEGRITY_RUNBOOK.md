# Fee integrity — turning the alarm on, and what to do when it fires

After the 2026-09-06 wipe (see `docs/` history and PRs #82 / #84) the code that
prevents and detects blank fee receipts is on `main`. Code on `main` is not
code that is running. This is the rest.

---

## 1. Deploy

```bash
gcloud auth login director@bhbinternational.school --update-adc
```

Only `director@bhbinternational.school` has GCP permissions on
`school-erp-prod-493619`. Then deploy from a clean export, never the live
worktree:

```bash
bash scripts/deploy-online.sh
```

Its early output lies — `bootstrap:go-live` and `wa:subscribe` print success
even when the deploy never reaches `gcloud builds submit`. Only the last line,
`Deploy submitted`, plus a **new revision id**, means it worked.

---

## 2. Say who gets the alarm

Add to `apps/web/.env.local` **before** deploying:

```
FEE_INTEGRITY_NOTIFY_MOBILE=919451938805
```

Comma-separated for more than one. `deploy-online.sh` passes it as a
substitution and `cloudbuild.yaml` writes it onto the service, so it survives
future deploys — do **not** set it with `gcloud run services update` alone.
Anything set only on the service is one deploy from reverting; that is how the
Gemini-primary decision was silently undone on 2026-08-18.

Leave it blank and the check falls back to `FLEET_EDGE_SOS_NOTIFY_MOBILE`, so
it is never completely silent — but set it deliberately.

---

## 3. Schedule the check

```bash
bash scripts/setup-cloud-scheduler.sh
```

Idempotent — it creates or updates every job, including the new
`bhb-fee-integrity-tick` (hourly, at :35). Confirm:

```bash
gcloud scheduler jobs describe bhb-fee-integrity-tick \
  --location=asia-southeast1 --project=school-erp-prod-493619
```

Then force one run and read the result:

```bash
gcloud scheduler jobs run bhb-fee-integrity-tick \
  --location=asia-southeast1 --project=school-erp-prod-493619
```

**A 500 is the job working, not the job broken**, when a blank receipt exists.
The tick deliberately fails while money has no breakdown, so the failure shows
in the job history instead of a green tick nobody reads. Today it will report
one: `RCV-00001`, ₹500 from March — one of the 13 written off after the
2026-09-01 incident, whose lines no backup holds.

Check without alerting anybody:

```bash
curl -s -X POST -H "x-cron-secret: $CRON_SECRET" \
  'https://bhbinternational.school/api/fees/integrity/tick?dryRun=1' | jq
```

---

## 4. Two things still unverified

**`K_SERVICE` on the live revision.** The write guard treats a process as the
deployed app when Cloud Run's `K_SERVICE` is set. NODE_ENV survives only as a
permissive fallback that logs loudly, so a wrong assumption cannot take the
app offline — but confirm it and then delete the fallback in
`apps/web/src/lib/supabase/server.ts`:

```bash
gcloud run services describe school-erp-web --region=asia-southeast1 \
  --project=school-erp-prod-493619 \
  --format='value(spec.template.spec.containers[0].env)' | tr ';' '\n' | grep K_SERVICE
```

`K_SERVICE` is injected by Cloud Run at runtime rather than declared on the
service, so it may not appear there. The honest check is from inside a running
container — hit any route that logs it, or read the first nightly sync's logs
for the absence of the "no K_SERVICE" warning this guard prints.

**The BigQuery snapshot DDL.** `create snapshot table … clone …` in
`bigQuerySync.server.ts` was never run against the real API — gcloud auth
expired before it could be. It is wrapped in try/catch, so a failure only
warns and the sync continues. After the first nightly run:

```bash
bq ls --project_id=school-erp-prod-493619 bhb_erp | grep __snap_
gcloud logging read 'resource.labels.service_name="school-erp-web"
  AND textPayload:"[bq-sync] snapshot"' --limit=20 \
  --project=school-erp-prod-493619
```

A row per table named `<table>__snap_YYYYMMDD` means it works. Warnings in the
log mean the DDL needs correcting.

---

## 5. Supabase point-in-time recovery

Not visible from the API — check it by hand, once:

**Supabase dashboard → project `BHB School` → Settings → Database → Backups.**

Daily backups come with the plan; PITR is a paid add-on. Without it, the
recovery window for a wipe is whatever BigQuery time travel still holds, which
is **seven days** — and that is what saved 1,913 fee lines on 2026-09-06,
by luck rather than design. Decide deliberately whether seven days is enough
for the school's books.

---

## When the alarm fires

1. **Do not let the counter re-collect.** Those months read unpaid but the
   money is in the bank. Voiding and re-taking is the damage, not the wipe.
2. Find the extent:
   ```sql
   select receipt_no, total_paise from fee_desk_vouchers v
    where v.voided_at is null and v.total_paise > 0
      and not exists (select 1 from fee_desk_voucher_lines l
                       where l.voucher_id = v.id);
   ```
3. A handful — repair by hand: **Fees → Receipts → Re-attach**. It refuses to
   save unless the allocation equals the money collected. Never use a waiver to
   make a month look settled; that records the money as forgiven, not paid.
4. Many — restore from BigQuery. The live mirror may already have copied the
   emptiness forward, so use **time travel**, and probe backwards to find the
   last good state:
   ```sql
   select count(*) from `school-erp-prod-493619.bhb_erp.fee_desk_voucher_lines`
   FOR SYSTEM_TIME AS OF TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 12 HOUR)
   ```
   `_synced_at` on the returned rows tells you which sync you are looking at.
   Then:
   ```bash
   ALLOW_LOCAL_PROD_WRITES=1 node scripts/restore-fee-lines.mjs \
     --dir=<dir with restore_lines.json / restore_tenders.json> --apply
   ```
   It inserts ON CONFLICT DO NOTHING, so it fills holes and never overwrites a
   row someone has since re-attached by hand. Run it with `--dry-run` first.
5. Verify against the receipts, not the script's own count — lines must sum to
   the receipt total.
