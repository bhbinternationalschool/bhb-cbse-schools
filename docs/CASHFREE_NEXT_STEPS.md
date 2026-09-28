# Cashfree — what to do, in order

Written 28 September 2026, for the Director. Plain words, in the order things
have to happen. Each step says what it is for, what to type, and how you know it
worked.

**Everything built on 28 Sep is on PR #331 and is NOT on `main` yet.** Nothing in
this guide is live until step 5.

---

## Step 1 — Revoke the leaked keys. Do this first.

Live production Cashfree secret keys were committed to this repository and pushed.
**This repository is public**, and GitHub's secret scanning is not switched on, so
nothing blocked it and nothing alerted you. Public GitHub is scraped for
credentials continuously.

The keys are out of the current files, but they remain in git history. **Deleting
them does not undo this. Only revoking them does.**

In the Cashfree dashboard, for **each of the three products separately**:

| Product | Where |
|---|---|
| Payment gateway | PG → Developers → API Keys |
| Bank verification | Verification Suite → Developers → API Keys |
| Payouts | Payouts → Developers → API Keys |

For each one: **regenerate the secret key**, which invalidates the old one.

Then two more things:

1. **Payouts → Developers → Two-Factor Authentication → Generate Public Key.**
   Generate a fresh one, because the client id it belongs to has been replaced.
2. **Look for activity you do not recognise** — payments, refunds, payout
   transfers, beneficiaries added. The payment-gateway secret also signs
   webhooks, so anybody holding it could have sent your ERP a fake "payment
   received".

**How you know it worked:** the dashboard shows a new secret, and the old one no
longer appears.

### While you are there — two settings worth changing

- **Make this repository private.** GitHub → Settings → General → Change
  visibility. This is your school's ERP: fee logic, WhatsApp integration, student
  data handling. Nothing about it needs to be public, and public means the next
  accident is instant and permanent.
- **Turn on secret scanning and push protection.** GitHub → Settings → Code
  security. Push protection would have **refused** that commit instead of
  accepting it. It is free.

---

## Step 2 — Restore the deploy trigger

**Nothing you merge reaches parents until this is fixed.** The Cloud Build
trigger that deploys on merge has not fired since 24 September. That is why PR
#329's fixes — the exam date sheet and the WhatsApp receipt template — merged
this morning and are still not live.

On your Mac, from the repository folder:

```bash
gcloud builds triggers list --project=school-erp-prod-493619 \
  --format='table(name,disabled,github.name,github.push.branch)'
```

- **A row appears and `disabled` is `False`** → the trigger exists. Skip to
  step 3.
- **Nothing listed, or `disabled` is `True`** → recreate it:

```bash
gcloud auth login director@bhbinternational.school
bash scripts/setup-deploy-on-merge.sh
```

It is safe to re-run; every step checks before it creates. It will stop once and
show you a link to approve Cloud Build's access to GitHub in a browser. Longer
explanation: `docs/DEPLOY_ON_MERGE.md`.

**How you know it worked:** the `triggers list` command above shows the trigger
with `disabled` as `False`.

---

## Step 3 — Put the new keys in the right file

The keys go in **`apps/web/.env.local`**. That file is on your Mac only and is
ignored by git.

**They do NOT go in `.env.cashfree.example`.** That file is tracked by git, which
is what caused step 1. Every line in it is now commented out so that cannot
happen quietly again.

```bash
cd <your repo folder>
git pull
git checkout claude/learning-commons-integration-54s7i2   # the work is on this branch
cat .env.cashfree.example >> apps/web/.env.local
```

Note `>>` and not `>`. A single `>` would erase your Supabase keys and WhatsApp
token and the app would stop starting.

Now open `apps/web/.env.local` in a text editor. At the bottom you will find the
block you just appended, with every line starting with `# `. **Remove the `# `
from the lines you are filling in**, and paste the values.

**Start with sandbox keys.** Every `_ENV` line already says `sandbox`. Sandbox and
production keys are not interchangeable — a production secret sent to a sandbox
address is rejected, and the error blames the secret rather than the mismatch.

### The public key is different — do not paste it by hand

A `.pem` is a multi-line file, and a multi-line value in a `.env` file **silently
loses everything after the first line**. The key then looks present and every
payout fails with "Signature Mismatched", which looks like a wrong password.

So let the script do it:

```bash
npm run cashfree:payout-key ~/Downloads/public_key.pem
```

It checks the file really is a public key, proves a signature can be made from
it, and writes it correctly. It will tell you plainly if you have given it the
wrong file — the hex string from the dashboard is a *fingerprint*, not the key.

You do not need to open the `.pem` at all. If you want to look: `cat
~/Downloads/public_key.pem`. If Cashfree gave you a `.zip`, the password is your
registered email address.

### Then check it

```bash
npm run check:cashfree
```

This says, for each of the three products, whether Cashfree accepts the keys. It
**never prints a secret**, so its output is safe to paste to me if something
fails. Nothing it does is billed — bank verification is checked against
Cashfree's own credential test, not a real ₹1 penny drop.

**How you know it worked:** three green ticks, and the closing line
`3 product(s) checked, all accepted by Cashfree.`

The most likely failures, and what they mean:

| What you see | What it means |
|---|---|
| `this is the same value as CASHFREE_APP_ID` | You used the payment-gateway keys for verification or payouts. Each product has its own pair. |
| `Cashfree REJECTED these keys` | Wrong product's keys, or sandbox keys against production (or the reverse). |
| `Signature Mismatched` | Use the **oldest** client id on the Payouts account, and a public key from the same environment. |
| `looks like a key FINGERPRINT` | You pasted the hex string. Download the `.pem` instead. |

---

## Step 4 — Merge PR #331

Once step 2 is done, tell me and I will merge it. That ordering matters: merging
before the trigger is fixed just adds to the pile on `main` that never deploys.

What merging gives you:

- who bears the gateway fee, with a settings screen and a report comparing what
  you charged against what Cashfree actually deducted
- refunds from the fee desk instead of the Cashfree dashboard
- parents told on the pay page that EMI and instalments exist
- bank-account verification before paying staff, vendors or refunds
- payouts, built but switched off (step 6)

---

## Step 5 — Production keys

Only when sandbox works, and only after step 1's new keys exist.

On the server the secrets do **not** live in a file. Create them once:

```bash
printf %s "<verification secret>" | gcloud secrets create \
  school-erp-cashfree-verification-secret-key --data-file=- \
  --project=school-erp-prod-493619

printf %s "<payout client secret>" | gcloud secrets create \
  school-erp-cashfree-payout-client-secret --data-file=- \
  --project=school-erp-prod-493619

gcloud secrets create school-erp-cashfree-payout-public-key \
  --data-file=$HOME/Downloads/public_key.pem \
  --project=school-erp-prod-493619
```

Then, and **only after those three exist**, add these to the `--set-secrets` line
in `cloudbuild.yaml`:

```
CASHFREE_VERIFICATION_SECRET_KEY=school-erp-cashfree-verification-secret-key:latest
CASHFREE_PAYOUT_CLIENT_SECRET=school-erp-cashfree-payout-client-secret:latest
CASHFREE_PAYOUT_PUBLIC_KEY=school-erp-cashfree-payout-public-key:latest
```

**Why this order, and why I did not do it for you:** a secret named on that line
that does not exist in Secret Manager fails the *entire* deploy. Wiring them in
before they exist would have broken every deploy — including ones that have
nothing to do with Cashfree — for features nobody had switched on. I made exactly
that mistake earlier and backed it out.

Change the `_ENV` lines in `apps/web/.env.local` to `production` when you are
ready, and deploy.

---

## Step 6 — Switch features on, one at a time

**Bank verification** works as soon as its keys are present. Nothing else to do.

**Who pays the gateway fee** stays as it is — the school absorbing it, exactly as
today — until you change it in **Accounts → Bank recon tab → "Who pays the gateway fee"** (scroll to the bottom, under Gateway settlements).
Before you move any payment method to "parent pays":

- confirm with your accountant how GST applies to a convenience fee, and
- confirm that adding a charge on top of a CBSE-regulated fee is defensible for
  your school.

The screen shows what a parent would actually be charged before you save, and the
report underneath tells you whether a rate is set too low and the school is
quietly absorbing the difference.

**Payouts is built but cannot send money.** `CASHFREE_PAYOUTS_ARMED=false`, and
every transfer checks it. This is deliberate: I could confirm Cashfree's hosts,
authentication and endpoint names, but not a complete request sample, so the code
is not proven against a live call. Before arming it:

1. fill in the sandbox Payouts keys (step 3)
2. open `/api/payouts?probe=1` while signed in as staff
3. it should create a test beneficiary and read a wallet balance
4. send me what it returns, and I will confirm or correct the request shapes
5. only then set `CASHFREE_PAYOUTS_ARMED=true`

Salary keeps going out through the existing NEFT bank file until that is done.

Also remember Payouts is a **prefunded wallet**: you top it up by bank transfer
from a whitelisted school account (Payouts → Fund Sources), and school money sits
with Cashfree between top-up and payout.

---

## Step 7 — Ask Cashfree for two things

These need Cashfree, not code. Ask your account manager:

1. **Enable "Customer VPA"** (Payouts/PG → Offline Payments → Collection Point
   Management). This gives each student their own UPI ID and QR code, so a parent
   paying from any UPI app is matched to the right child automatically. It is the
   fix for "whose ₹2,500 is this?" — which cost a day in September. It is off by
   default and only they can switch it on. A virtual *bank* account is not an
   alternative: UPI payments into one are not permitted by NPCI.

2. **Confirm whether Subscriptions is enabled.** That is what would let fees be
   auto-debited monthly by e-NACH or UPI Autopay instead of being chased.

Tell me when either is on and I will build it. I have deliberately not written
code against them, because code written against an API I cannot call is how five
fixes shipped in September against code that never ran.

---

## Still outstanding, separately

- **Google Play**: resubmit in Play Console. It was rejected on 17 Sep for the
  reviewer login; the fix has been on `main` since 18 Sep.
- **Google Workspace for Education**: file the case in the Admin Console. The
  text was emailed to you on 25 Sep.
- **Bhashini**: the ULCA pair from <https://bhashini.gov.in/ulca/profile>
  (My Profile → Generate) — not the Udyat app key. The keys pasted into chat on
  27 Sep should be revoked and regenerated too.
- **AADVIK SINGH's ₹2,500** is booked (receipt RCV-00648). The parent's WhatsApp
  receipt was never sent; the template fix merged this morning but is not live
  until step 2.
