# Deploy on merge — ship from your phone

**What changes:** when a pull request is merged into `main` — from the GitHub
app on your phone, or by telling Claude "merge" — Google Cloud Build deploys
it to bhbinternational.school by itself, in about 10 minutes. No laptop, no
`gcloud` login, no deploy command.

**What stays the same:** nothing reaches the website unless a person merged
it. The nightly Claude review only *opens* pull requests; you decide.

## How it works

`cloudbuild.deploy-on-merge.yaml`, started by the `deploy-on-merge` trigger on
every push to `main`:

1. **env** — writes `apps/web/.env.local` from Secret Manager
   (`school-erp-deploy-env`, a copy of your laptop's `.env.local`).
2. **preflight** — refuses to deploy if the Supabase keys, the cron guard or
   the Play reviewer login are missing (each has been lost by a deploy
   before), and records the revision that is live now.
3. **deploy** — runs `scripts/deploy-online.sh`, the same script you run by
   hand, with demo auth forced off.
4. **smoke test** — `/login` must answer, and the Play reviewer
   (9000000001) must be able to sign in. If either fails, traffic goes
   **straight back to the previous revision** and the build is marked failed.

## One-time setup (≈ 10 minutes, on the laptop, once)

```bash
cd "/Users/ashishsingh/CBSE Schools"
git pull
gcloud auth login director@bhbinternational.school
bash scripts/setup-deploy-on-merge.sh
```

The script stops once and prints a link: open it, sign in to GitHub and
install the **Google Cloud Build** app for `bhbinternationalschool` (the
`bhb-cbse-schools` repository is enough). Then run the same command again —
it carries on from where it stopped.

It creates the identity `bhb-autodeploy@school-erp-prod-493619.iam.gserviceaccount.com`
with only what the deploy uses: start builds, update the two Cloud Run
services (and move traffic back on a failed smoke test), write its logs,
upload build source, run as the app's own runtime identity, and read the one
secret `school-erp-deploy-env`. No key file is created (the organisation
blocks keys anyway).

## Day to day

| You want to… | Do this |
|---|---|
| Ship a fix | Merge the pull request (GitHub app → Merge). |
| See whether it went live | Cloud Build → History in the Google Cloud app/console; a green build = live, smoke test passed. |
| Deploy again without a change | `gcloud builds triggers run deploy-on-merge --region=asia-southeast1 --branch=main` |
| Merge without deploying | Put `[skip ci]` in the merge commit message. |
| Change a setting / key in `.env.local` | Edit it on the laptop, then `bash scripts/update-deploy-env-secret.sh`. Until you do, merges deploy with the old copy. |
| Undo a bad deploy by hand | Cloud Run → school-erp-web → Revisions → send 100% to the previous one. |

The manual `scripts/deploy-online.sh` still works exactly as before.
