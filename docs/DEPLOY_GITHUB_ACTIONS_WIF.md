# Deploy from GitHub Actions — keyless via Workload Identity Federation

The alternative to a Cloud Build GitHub connection. Here the trust lives on
**GitHub's** side: a GitHub Actions job proves who it is with a short-lived
OIDC token, Google verifies that token against a Workload Identity provider
and lets the job impersonate the `bhb-deploy` service account — **no key**
(this org's policy blocks keys) and **no Cloud Build↔GitHub OAuth connection**.

`.github/workflows/deploy.yml` is already committed. It runs the same
self-contained `cloudbuild.yaml` a local deploy does, so once the federation
below exists, merging to `main` deploys itself.

## The one rule that matters most

**The provider MUST be locked to this repository.** A Workload Identity
provider that trusts "any GitHub Actions token" lets *any repo on GitHub*
impersonate your deploy SA. The setup below pins it two ways — an
`--attribute-condition` on the provider and a `principalSet` scoped to the
repo in the IAM binding — and both must name
`bhbinternationalschool/bhb-cbse-schools`. Do not loosen either.

## One-time setup (you run these — they mint federation and grant impersonation)

```bash
PROJECT=school-erp-prod-493619
PROJECT_NUMBER=287837565122
SA="bhb-deploy@${PROJECT}.iam.gserviceaccount.com"
REPO="bhbinternationalschool/bhb-cbse-schools"

# 1. A pool to hold external (GitHub) identities.
gcloud iam workload-identity-pools create github-pool \
  --project="$PROJECT" --location=global \
  --display-name="GitHub Actions"

# 2. An OIDC provider trusting GitHub's token issuer — LOCKED to this repo.
#    The attribute-condition is the guardrail: tokens from any other repo are
#    rejected before impersonation is even attempted.
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --project="$PROJECT" --location=global \
  --workload-identity-pool=github-pool \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository=='${REPO}'"

# 3. Let ONLY this repo's Actions impersonate the deploy SA.
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --project="$PROJECT" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/${REPO}"
```

The `workload_identity_provider` value already in `deploy.yml` is
`projects/287837565122/locations/global/workloadIdentityPools/github-pool/providers/github-provider`
— it matches the names above. If you change any name, update the workflow.

## GitHub side (you do this in the repo settings)

The eight non-secret substitution values go in **repo variables**, not secrets
(they are public keys / ids / an IP list — none are credentials):

**Settings → Secrets and variables → Actions → Variables → New variable**, add
each with the value from your `apps/web/.env.local`:

| Variable | From `.env.local` key |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` |
| `WHATSAPP_PHONE_ID` | `WHATSAPP_PHONE_ID` |
| `WHATSAPP_WABA_ID` | `WHATSAPP_WABA_ID` |
| `GOOGLE_OAUTH_CLIENT_ID` | `GOOGLE_OAUTH_CLIENT_ID` |
| `FLEET_EDGE_ALLOWED_IPS` | `FLEET_EDGE_ALLOWED_IPS` |
| `FLEET_EDGE_SOS_NOTIFY_MOBILE` | `FLEET_EDGE_SOS_NOTIFY_MOBILE` |
| `REVIEW_LOGIN_MOBILE` | `REVIEW_LOGIN_MOBILE` |
| `REVIEW_LOGIN_HOUSEHOLD_ID` | `REVIEW_LOGIN_HOUSEHOLD_ID` |
| `CASHFREE_APP_ID` | `CASHFREE_APP_ID` |
| `CASHFREE_VERIFICATION_APP_ID` | `CASHFREE_VERIFICATION_APP_ID` |
| `CASHFREE_PAYOUT_CLIENT_ID` | `CASHFREE_PAYOUT_CLIENT_ID` |
| `NEXT_PUBLIC_PAYMENT_GATEWAY` | `NEXT_PUBLIC_PAYMENT_GATEWAY` |
| `BIGQUERY_PROJECT_ID` | `BIGQUERY_PROJECT_ID`, else the live service's value |

**One value is NOT a repo variable: the Play reviewer code**
(`REVIEW_LOGIN_CODE`). It is a password - for one fictional household, but a
password - so it must never appear in a workflow file, a substitutions list,
a build record, a shell history, or a chat message. `cloudbuild.yaml` binds
it from Secret Manager like every other credential.

Create it in the Google Cloud Console (no command line involved): Secret
Manager > **Create secret** > name `school-erp-review-login-code`, project
`school-erp-prod-493619`, and paste the value of `REVIEW_LOGIN_CODE` from
`apps/web/.env.local` exactly - no surrounding quotes, no trailing newline.

Then grant `roles/secretmanager.secretAccessor` on it to the same service
accounts that read the other `school-erp-*` secrets: the Cloud Build service
account (binds it at deploy) and the Cloud Run runtime service account
(reads it at request time). Until this secret exists, every deploy through
`cloudbuild.yaml` - from GitHub Actions or `scripts/deploy-online.sh` -
fails; the script checks for it before starting the build.

The workflow refuses to deploy when any of the fifteen variables above is
empty or the secret's latest version is not ENABLED, because
`cloudbuild.yaml`'s `--set-env-vars` replaces the whole Cloud Run
environment: a missing value is not left alone, it is erased from the live
service. Demo auth is pinned `false` in the workflow as a literal. Passing
this preflight does NOT make a deploy safe on its own: it does not verify
that the variable values match the live service (compare with
`gcloud run services describe` before the first run) or that the IAM grants
above are in place - both stay release blockers until checked by someone
with Cloud access.

The real credentials are already in Secret Manager and bound by
`cloudbuild.yaml`; none of them go into GitHub.

## The identity chain, and one permission to verify

The job impersonates `bhb-deploy`, which runs `gcloud builds submit`. The build
then executes as the **Cloud Build service account** — the same identity that
runs a local deploy's build today, so build → push → `run deploy` already work.

The one thing to watch on the first run: `cloudbuild.yaml`'s final step does
`gcloud run services update` to apply the desk-cutover runtime flags, and that
runs as the **build** SA. If that step 403s (the build SA lacks `run.admin`),
grant it once:

```bash
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/run.admin" --condition=None   # if not already present
```

(The IAM dump on 2026-08-23 showed the compute SA already holds `run.admin`,
so this is likely a no-op — verify rather than assume.)

## Prove it before relying on it

1. Merge a trivial change to `main`, or use **Actions → Deploy to production →
   Run workflow**.
2. The job must pass the auth step (proves WIF), then all four `cloudbuild.yaml`
   steps, then print the new revision.
3. **`scripts/deploy-online.sh` stays the working fallback** until a WIF deploy
   has succeeded once — `.env.local` is untouched.

## WIF vs the Cloud Build trigger

| | GitHub Actions + WIF | Cloud Build trigger |
|---|---|---|
| Console OAuth to connect GitHub | not needed | required (one-time) |
| Where CI runs | GitHub runners | Cloud Build |
| Keyless | yes | yes |
| Main risk to get right | repo-locked provider condition | none beyond substitutions |
| Reuses `bhb-deploy` SA | yes | yes |

Pick one, not both — two automations on `main` would double-deploy.
