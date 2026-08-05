# Admissions WhatsApp bot — go-live guide

Step-by-step: Meta webhook → deploy → leads → test → counsellor training.

---

## Part 1 — Meta webhook (Business Manager)

### Prerequisites

- Meta Business account linked to **BHB International School** WhatsApp number
- WhatsApp Business API (Cloud API) — not only the WhatsApp Business app on a phone
- A permanent **System User** token with `whatsapp_business_messaging` (+ `whatsapp_business_management` for templates)

### A. Get IDs and token

1. Open [Meta Business Suite](https://business.facebook.com) → **Settings** → **Business settings**
2. **Users** → **System users** → create/select system user → **Generate token**
3. Select your **WhatsApp app** → permissions: `whatsapp_business_messaging`, `whatsapp_business_management`
4. Copy token → `WHATSAPP_TOKEN` in `apps/web/.env.local`
5. **WhatsApp Manager** → **API setup**:
   - **Phone number ID** → `WHATSAPP_PHONE_ID`
   - **WhatsApp Business Account ID** → `WHATSAPP_WABA_ID`
6. Choose a random verify string (e.g. `bhb-wa-verify-2026`) → `WHATSAPP_VERIFY_TOKEN`

### B. Configure webhook

1. Meta Developer → your app → **WhatsApp** → **Configuration**
2. **Webhook** → **Edit**
3. **Callback URL:**  
   `https://bhbinternational.school/api/wa/webhook`
4. **Verify token:** same as `WHATSAPP_VERIFY_TOKEN`
5. Click **Verify and save** (Meta sends `GET` with `hub.challenge` — your server must be live)
6. **Webhook fields** — subscribe:
   - `messages` (required)
   - `message_template_status_update` (for template approval sync)

### C. Subscribe app to WABA

After deploy, either:

```bash
cd apps/web && npm run wa:subscribe
```

or:

```bash
curl -X POST https://bhbinternational.school/api/wa/setup \
  -H "Content-Type: application/json" \
  -d '{"action":"subscribe"}'
```

### D. Confirm

```bash
curl https://bhbinternational.school/api/wa/setup
curl https://bhbinternational.school/api/integrations/health
```

`outboundConfigured: true` and no critical issues in setup report.

---

## Part 2 — Deploy with WhatsApp env

Ensure `apps/web/.env.local` has all WhatsApp keys, then:

```bash
./scripts/deploy-online.sh
```

This passes `WHATSAPP_*` to Cloud Run and runs bootstrap + WABA subscribe.

**Production env checklist:** see [deploy/README.md](../deploy/README.md) and [deploy/env.production.example](../deploy/env.production.example).

---

## Part 3 — Import leads (optional but recommended)

Existing Excel leads:

```bash
cd apps/web
npm run import:leads
```

Place files in `data/leads/` (`Field_Leads.xlsx`, `BHB_School_Enquiry_Survey.xlsx`).

**New behaviour:** If a parent messages and **no lead exists**, the bot **auto-creates** a CRM enquiry (`source: whatsapp`) with:

- Mobile from WhatsApp
- Guardian name from WhatsApp profile (or “WhatsApp Parent”)
- Placeholder child name until counsellor updates
- Follow-up log: first inbound message

---

## Part 4 — Test one parent number

Use a personal phone **not** already in CRM.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Message school WA number: `Hi` | Admissions welcome + keywords |
| 2 | Reply `STATUS` | Enquiry number + “Open enquiry” (auto-created) |
| 3 | Reply `REGISTER` | Link to `/register?src=wa_bot` |
| 4 | Reply `HUMAN` | “Connecting to Admissions desk…” |
| 5 | ERP → Admissions → **CRM parent chat** → WhatsApp | Thread visible, unread badge |
| 6 | Staff types reply | Parent receives on WhatsApp (within 24h window) |
| 7 | Admissions → Leads list | New lead with source **WhatsApp** |

If outbound fails: check `WHATSAPP_TOKEN`, 24h window, or use template for cold outreach.

---

## Part 5 — Train counsellors (CRM parent chat)

**Printable one-pager:** [WHATSAPP_COUNSELLOR_ONE_PAGER.md](./WHATSAPP_COUNSELLOR_ONE_PAGER.md)

**Where:** ERP → **Admissions** → tab **CRM parent chat**

### Daily workflow

1. Open **WhatsApp** channel (not web widget)
2. Sort by unread — red badge = parent waiting
3. Read bot transcript (FEE / STATUS / HUMAN keywords)
4. Reply in the text box → sends via school WhatsApp API
5. Update lead record: child name, class sought, assign counsellor
6. Log phone follow-ups in lead detail or Field → **Lead calling**

### Keywords parents use

| Parent sends | Meaning |
|--------------|---------|
| FEE | Registration fee + pay link |
| REGISTER | Online form |
| DOCS | Document list |
| STATUS | Enquiry status from CRM |
| VISIT | Campus visit |
| HUMAN | Escalate to counsellor |
| MENU | Main school menu |

### Rules

- **24-hour rule:** Free-text replies only within 24h of parent’s last message; otherwise use approved **templates** (Masters → WhatsApp templates).
- **Enrolled parents** should use Parent portal — this bot is for **admission seekers** only.
- Auto-created leads need **child name + class** filled by counsellor after first contact.

---

## Troubleshooting

### Local / staging webhook test (no Meta)

With dev server running (`npm run dev`):

```bash
cd apps/web

# Simulate Meta verify handshake
npm run test:wa-webhook -- --verify

# Simulate parent "Hi" (creates lead if new number)
npm run test:wa-webhook -- --message "Hi" --from 9876543210 --name "Test Parent"

# Admissions STATUS keyword
npm run test:wa-webhook -- --admission --from 9876543210

# Against production
npm run test:wa-webhook -- --message "Hi" --url https://bhbinternational.school --from 9876543210
```

Then check **Admissions → CRM parent chat → WhatsApp** and **Leads** list.

| Problem | Fix |
|---------|-----|
| Webhook verify fails | Deploy live URL first; `WHATSAPP_VERIFY_TOKEN` must match Meta exactly |
| No auto-reply | Check Cloud Run logs; `GET /api/wa/webhook` should show `outboundConfigured: true` |
| Inbox empty | `WA_THREADS_READ_FROM_DB` on production; webhook receiving POST |
| STATUS says no lead | Mobile mismatch — check 10-digit match on lead |
| Staff reply not delivered | 24h window expired; or token/phone ID wrong |

---

## Related files

| File | Role |
|------|------|
| `waCrmBotServer.ts` | Inbound handler + staff reply |
| `crmAdmissionBotEngine.ts` | Keyword intents |
| `admissionsLeadIngest.server.ts` | Auto-create lead + Google leads |
| `AdmissionCrmChatInbox.tsx` | Staff inbox UI |
| `/api/wa/webhook` | Meta entry point |
