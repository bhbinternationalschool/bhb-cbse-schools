# Artifact Registry cleanup policy

`artifact-cleanup-policy.json` is applied to the `bhb-school-erp-repo`
repository in `asia-southeast1`. It prunes old container images automatically.

```bash
gcloud artifacts repositories set-cleanup-policies bhb-school-erp-repo \
  --location=asia-southeast1 --project=school-erp-prod-493619 \
  --policy=deploy/artifact-cleanup-policy.json --no-dry-run
```

Use `--dry-run` first when changing the rules; it evaluates and logs without
deleting. Confirm which mode is active by reading `cleanupPolicyDryRun` from
`gcloud artifacts repositories describe` — the field is **absent** when the
policy is enforcing, and `true` when it is only simulating.

## Why it exists

By 2026-08-22 the repository held **489 images across 411 Cloud Run revisions,
58.8 GB**, because nothing had ever deleted an old build. Every deploy adds
roughly 120 MB permanently. The one-off cleanup that day took it back to 5
images; this policy is what stops it happening again.

## The rule that matters

`keep-recent-releases` keeps the 10 most recent images **whatever their age**,
and KEEP beats DELETE in Artifact Registry.

That is not tidiness, it is a safety interlock. The service now runs with
`min-instances=0`, so a revision that has not served a request in weeks still
needs its image present to cold-start. Deleting the image behind a live
revision would leave the site unable to start, and nobody would find out until
the next person opened it. The keep-10 rule means the serving image survives
even if nobody deploys for months.

Do not replace the keep rules with a pure age-based delete.
