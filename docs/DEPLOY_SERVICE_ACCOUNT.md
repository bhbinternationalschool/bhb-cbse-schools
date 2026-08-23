# Non-interactive deploys — service-account key

`scripts/deploy-online.sh` used to die whenever the interactive `gcloud`
login expired (it happened on the 2026-08-14 and 2026-08-23 deploys, each
time mid-run, after the build had already started warming up). A dedicated
deploy **service-account key** removes that: a key does not expire the way a
browser login does, so the script authenticates and runs unattended.

The script already looks for the key — you only have to create it once. These
commands need your own admin rights on the project, so **you run them**, not
the assistant: creating a service account, granting IAM roles, and minting a
key are exactly the operations that must stay with a human.

## One-time setup

```bash
PROJECT=school-erp-prod-493619
SA="bhb-deploy@${PROJECT}.iam.gserviceaccount.com"
RUNTIME_SA="287837565122-compute@developer.gserviceaccount.com"

# 1. A dedicated, least-privilege deploy identity.
gcloud iam service-accounts create bhb-deploy \
  --project="$PROJECT" \
  --display-name="BHB deploy (Cloud Build + Run, local)"

# 2. Exactly the roles the deploy uses — nothing wider.
#    - submit Cloud Builds (the build pushes the image and deploys)
#    - update the Cloud Run service (services update / update-traffic)
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" --role="roles/cloudbuild.builds.editor"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" --role="roles/run.admin"

#    - act AS the runtime service account, so Run can be deployed as it.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --project="$PROJECT" \
  --member="serviceAccount:$SA" --role="roles/iam.serviceAccountUser"

#    - upload the build source tarball to the Cloud Build bucket.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" --role="roles/storage.objectAdmin"

# It deliberately gets NO Secret Manager access: the secrets are already bound
# to the service and the deploy only ever touches non-secret env vars.

# 3. Mint the key straight to its home OUTSIDE the repo.
mkdir -p ~/.config/bhb-deploy
gcloud iam service-accounts keys create ~/.config/bhb-deploy/deploy-sa.json \
  --iam-account="$SA" --project="$PROJECT"
chmod 600 ~/.config/bhb-deploy/deploy-sa.json
```

That's it. The next `./scripts/deploy-online.sh` prints
`Authenticating with deploy service-account key…` and runs without a login.

## Where the key lives, and why there

`~/.config/bhb-deploy/deploy-sa.json` — **outside the working tree on
purpose.** A key inside the repo could be committed, or swept into the
`git archive` export that gets shipped to Cloud Build. The script refuses to
use a key found under the repo root for exactly that reason, and
`.gitignore` blocks `deploy-sa*.json` as a second line of defence.

Override the path with `DEPLOY_SA_KEY=/some/other/path.json ./scripts/deploy-online.sh`.

With no key present, the script falls back to the interactive login exactly
as before — nothing breaks for anyone who has not set this up.

## This is a long-lived credential — treat it like one

A service-account key does not expire, which is the point and also the risk:
anyone who copies the file can deploy as this identity until the key is
revoked. So:

- **Never commit it, never paste it, never email it.** It stays on the deploy
  machine.
- **Rotate it** periodically — mint a new key, swap the file, then delete the
  old key:
  ```bash
  gcloud iam service-accounts keys list --iam-account="$SA" --project="$PROJECT"
  gcloud iam service-accounts keys delete <OLD_KEY_ID> --iam-account="$SA" --project="$PROJECT"
  ```
- **If it ever leaks**, delete the key immediately with the command above; the
  identity is useless the moment its keys are gone.

If your organisation blocks service-account key creation
(`iam.disableServiceAccountKeyCreation`), the keyless alternative is Workload
Identity Federation — more setup, no long-lived secret. Ask and it can be
wired instead.
