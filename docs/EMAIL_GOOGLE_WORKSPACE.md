# Email channel — Google Workspace (Gmail API)

**Status 2026-09-08:** code shipped and now **keyless**; still **not connected** until the two steps below are done. Until then every "Send email" button is disabled and the UI falls back to Copy.

**No service-account key is used, or can be.** This organisation enforces
`constraints/iam.disableServiceAccountKeyCreation`, so `gcloud iam
service-accounts keys create` is refused — correctly: a downloadable key that
can send mail as any mailbox in the domain is exactly what that policy exists
to prevent. Instead Cloud Run asks IAM Credentials to sign the JWT *as*
`erp-mail-sender`, which it may do because the runtime service account holds
`roles/iam.serviceAccountTokenCreator` on it. The signing key never leaves
Google: nothing to download, rotate, leak, or delete from a laptop.
`GMAIL_SA_KEY_JSON` is still honoured when present, for local development or a
project whose policy allows keys.

**What is left (both are one-time):**

1. **Grant the runtime permission to sign as the mailer** — GCP owner:
   ```bash
   gcloud iam service-accounts add-iam-policy-binding \
     erp-mail-sender@school-erp-prod-493619.iam.gserviceaccount.com \
     --member="serviceAccount:287837565122-compute@developer.gserviceaccount.com" \
     --role="roles/iam.serviceAccountTokenCreator" \
     --project=school-erp-prod-493619
   ```
2. **Domain-wide delegation** — Workspace super-admin, at **admin.google.com**
   (NOT the Cloud console): Security → Access and data control → API controls →
   Manage Domain-wide Delegation → Add new. Client ID
   **`111598348268367566988`** (the service account's numeric uniqueId — its
   email address will not work here), scope
   `https://www.googleapis.com/auth/gmail.send`.

Already done: the `erp-mail-sender` service account exists, the Gmail API is
enabled, and `GMAIL_SA_KEY_JSON` is bound to Cloud Run (holding `{}`, which the
keyless path ignores).

---

### The original key-based instructions, kept for reference

**How it works:** the ERP sends *as* a Workspace mailbox chosen per purpose (Comms → **Email**): Admissions (default `admissions@`), Fees & receipts (`accounts@`), Reports & leadership (`principal@`), General office (`office@`). A Google service account with domain-wide delegation impersonates that mailbox and calls `gmail.users.messages.send`; sent mail appears in the mailbox's Sent folder, replies land in its inbox, DKIM/SPF are Google's. No third-party provider, no cost. Every send is logged (Comms → Email → Recent emails).

**One-time setup (≈15 min, Workspace super-admin + GCP owner):**
1. Workspace Admin → Users → create the mailboxes above (or change the per-purpose addresses in Comms → Email to existing ones; display names there too).
2. GCP `school-erp-prod-493619` → IAM & Admin → Service accounts → Create `erp-mail-sender` → Keys → Add key → JSON (download). APIs & Services → Enable **Gmail API**.
3. Workspace Admin → Security → Access and data control → API controls → Manage **Domain-wide delegation** → Add new → paste the service account's **Client ID** (numeric, from the SA details page) → OAuth scope `https://www.googleapis.com/auth/gmail.send` → Authorise.
4. Upload the JSON key to Secret Manager (already created as a placeholder and bound to Cloud Run as `GMAIL_SA_KEY_JSON`):
   ```bash
   gcloud secrets versions add school-erp-gmail-sa-key --data-file=/path/to/erp-mail-sender.json
   ```
   New Cloud Run revisions read `latest`; the currently running revision picks it up at the next deploy (or `gcloud run services update school-erp-web --region asia-southeast1 --update-secrets=GMAIL_SA_KEY_JSON=school-erp-gmail-sa-key:latest`).
5. Comms → Email → **Send test** for each purpose. An `unauthorized_client` error means step 3 is missing or the mailbox does not exist.

**Where it is used:** Admissions lead panel → Draft follow-up → Email tab → **Send email & log** (admissions mailbox; logs a follow-up with channel `email`). `POST /api/email/send { purpose, to, subject, text, html?, attachments? }` is the general API (permission = edit on the purpose's module) for the next consumers: offer / deficiency letters, receipts, scheduled reports.

**Limits:** ~2,000 mails/day per sending mailbox (Workspace). For bulk newsletters use a campaign tool; this channel is for transactional and one-to-one mail.
