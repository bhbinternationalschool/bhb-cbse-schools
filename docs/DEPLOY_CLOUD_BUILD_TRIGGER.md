# Deploy on merge to main — Cloud Build trigger

The goal: merging to `main` deploys itself, in GCP, with no local `gcloud` and
no expiring login. This replaces having to run `scripts/deploy-online.sh` from
a laptop whose session keeps timing out (and it needs no service-account key,
which this org's policy blocks anyway).

`cloudbuild.yaml` already builds, pushes, deploys, and binds every secret from
Secret Manager. Two things had to change so a trigger — which checks out the
repo and has **no `apps/web/.env.local`** — can run it, and both are done:

- **Desk-cutover flags are now committed.** `deploy/desk-cutover-build.env`
  (38 build-time `NEXT_PUBLIC_*` flags, inlined into the client bundle) and
  `deploy/desk-cutover-runtime.env` (114 runtime flags) replace the gitignored
  generated files. Every value is `true` — the cutover is complete — and they
  were captured to match the live service exactly (verified 2026-08-23). The
  Dockerfile reads the committed build file; a step in `cloudbuild.yaml`
  applies the runtime file after deploy.
- **Nothing secret moved.** The real credentials are already in Secret Manager
  and bound by `cloudbuild.yaml`. Only non-secret config remains to hand the
  trigger, as substitution variables (below).

## What only you can do

Creating the GitHub connection is an OAuth flow in the console, and creating
the trigger is a project-admin action — neither is something the assistant can
or should do.

### 1. Connect the repo to Cloud Build (one-time)

Console → **Cloud Build → Repositories → Create host connection**, pick GitHub,
authorise the `bhbinternationalschool` org, and link
`bhbinternationalschool/bhb-cbse-schools`. (This is the 2nd-gen "Repositories"
connection.)

### 2. Create the trigger

Set the non-secret substitution values from your current `apps/web/.env.local`
(the same values `deploy-online.sh` passes today — none are secret: public
Supabase URL/anon key, VAPID public key, WhatsApp phone/WABA ids, OAuth client
id, Fleet Edge allow-list). Fill each `...` from `.env.local`:

```bash
PROJECT=school-erp-prod-493619
REGION=asia-southeast1

gcloud builds triggers create github \
  --project="$PROJECT" --region="$REGION" \
  --name="deploy-main" \
  --repository="projects/${PROJECT}/locations/${REGION}/connections/<CONNECTION>/repositories/bhb-cbse-schools" \
  --branch-pattern="^main$" \
  --build-config="cloudbuild.yaml" \
  --service-account="projects/${PROJECT}/serviceAccounts/bhb-deploy@${PROJECT}.iam.gserviceaccount.com" \
  --substitutions=\
_NEXT_PUBLIC_SUPABASE_URL=...,\
_NEXT_PUBLIC_SUPABASE_ANON_KEY=...,\
_NEXT_PUBLIC_VAPID_PUBLIC_KEY=...,\
_WHATSAPP_PHONE_ID=...,\
_WHATSAPP_WABA_ID=...,\
_GOOGLE_OAUTH_CLIENT_ID=...,\
_FLEET_EDGE_ALLOWED_IPS=...,\
_FLEET_EDGE_SOS_NOTIFY_MOBILE=...
```

The `bhb-deploy` SA (already created, with `run.admin` scoped to
`school-erp-web`, `cloudbuild.builds.editor`, `actAs` the runtime SA, and
object access to the build bucket) is the identity the trigger runs as. It has
exactly the deploy permissions and nothing wider.

### 3. Grant the trigger SA one more role it needs at trigger time

A trigger's own SA needs to write build logs and read the connected repo:

```bash
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:bhb-deploy@${PROJECT}.iam.gserviceaccount.com" \
  --role="roles/logging.logWriter" --condition=None
```

## Prove it before relying on it

The first real trigger build is the only end-to-end test — a sourceless config
check can't exercise the Docker build or the deploy. So:

1. Merge a trivial change to `main` (or hit **Run** on the trigger).
2. Watch the build. It must reach and pass **all four steps** — build, push,
   `run deploy`, and the desk-runtime env update.
3. Confirm the new revision serves and the desk flags are present:
   ```bash
   gcloud run services describe school-erp-web --region=asia-southeast1 \
     --project=school-erp-prod-493619 --format='value(status.traffic[0].revisionName)'
   ```

**If the trigger build fails, nothing is lost:** `scripts/deploy-online.sh`
still works from a laptop exactly as before (it reads `.env.local`, which is
untouched). Keep it as the fallback until a trigger deploy has succeeded once.

## What the trigger does NOT do (and whether it matters)

`deploy-online.sh` also runs two optional, idempotent extras the trigger skips:

- `bootstrap:go-live` — seeds Supabase RBAC + the director profile. Already
  seeded in production; only matters on a fresh database.
- `wa:subscribe` — subscribes the Meta app to the WABA webhook. Already
  subscribed. Re-run manually if the webhook is ever reset.

Neither is needed on a routine deploy, which is why they are left out of the
unattended path.
