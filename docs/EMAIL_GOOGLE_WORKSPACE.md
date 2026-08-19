# Email channel — Google Workspace (Gmail API)

**Status 2026-08-19:** code shipped; **not connected** until the one-time steps below are done. Until then every "Send email" button is disabled and the UI falls back to Copy.

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
