# Virtual staff room — n8n office (Phase 1)

AI employees for BHB International School, run by self-hosted [n8n](https://n8n.io)
and driven by Claude. Phase 1 gives the school two employees and a daily meeting:

| Employee | Workflow | Runs | Models |
|---|---|---|---|
| **Receptionist** | `workflows/receptionist.json` | every minute (Gmail poll) + every 5 min (approvals) | Haiku 5.5 sorts, Sonnet 5.5 drafts |
| **Academic Incharge** | `workflows/academic-incharge.json` | 06:00 IST daily | Sonnet 5.5 |
| **Morning huddle** (chair + roster) | `workflows/morning-huddle.json` | 06:30 IST daily | Sonnet 5.5 |

They coordinate through four `office_*` tables in the ERP's Supabase project
(migration `supabase/migrations/20261021120000_office_staff_room.sql`), talk to
the school only through the ERP's own routes, and every message to a parent or
vendor waits for the director's **APPROVE** on WhatsApp.

```
Gmail inbox ──▶ Receptionist ──┬─▶ office_tasks (draft, pending) ──▶ director on WhatsApp ──APPROVE──▶ Gmail reply
                               ├─▶ office_tasks (CBSE/UDISE → academic_incharge)
                               └─▶ office_notes
ERP tables (leave, attendance, timetable) ──▶ Academic Incharge ──▶ office_notes + WhatsApp plan + office_tasks (director)
office_notes + office_tasks ──▶ Morning huddle (chair → each employee → chair) ──▶ office_meetings + office_tasks + WhatsApp minutes
every Claude call ──▶ office_ai_usage (tokens, estimated USD)
```

## 1. Run n8n on a VM in GCP

Project `school-erp-prod-493619`, same project as the ERP's Cloud Run service.
Use GCP's **Always Free** tier: one **e2-micro** (2 shared vCPU, 1 GB RAM)
with a 30 GB standard disk in `us-central1`, `us-west1` or `us-east1` costs
₹0 for as long as the account exists. The free tier is region-locked to
those three, so do not create it in `asia-south1`; latency to India does not
matter for a workflow that runs on a timer. n8n idles at ~300 MB and keeps its
own state in SQLite on the VM's disk, so 1 GB plus a swap file is enough for
Phase 1 (three Claude calls a morning and a Gmail poll).

```bash
gcloud compute instances create office-n8n \
  --project=school-erp-prod-493619 --zone=us-central1-a \
  --machine-type=e2-micro --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard --tags=office-n8n
```

On the VM (the swap file is what keeps a 1 GB machine alive when n8n and
Docker both page in at 6 am):

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker "$USER" && newgrp docker
git clone --depth 1 --filter=blob:none --sparse https://github.com/bhbinternationalschool/CBSE-Schools.git
cd CBSE-Schools && git sparse-checkout set automation/n8n && cd automation/n8n
cp .env.example .env && nano .env          # fill every value (section 2)
docker compose config >/dev/null && docker compose up -d
docker compose logs -f n8n                 # until "Editor is now accessible"
```

n8n listens on `127.0.0.1:5678` only. Reach it from your Mac over an SSH tunnel
(no public port, no firewall rule needed):

```bash
gcloud compute ssh office-n8n --project=school-erp-prod-493619 --zone=us-central1-a -- -N -L 5678:127.0.0.1:5678
```

then open <http://localhost:5678>, create the owner account (the director's
email), and continue with section 3. For a permanent address later, put
Cloudflare Tunnel or IAP in front and set `N8N_HOST` / `N8N_PROTOCOL` /
`N8N_WEBHOOK_URL` in `.env` (Gmail OAuth needs the public URL as redirect).

Container-Optimized OS works too (`--image-family=cos-stable`): Docker is
preinstalled, but `docker compose` must be run through the
`docker/compose` image. Debian is less fuss.

### Cost

| Item | ₹ / month (approx.) |
|---|---|
| e2-micro + 30 GB pd-standard in us-central1 (Always Free tier: one per billing account, no expiry; egress to India stays far under the free 1 GB/month) | ₹0 |
| If Phase 2 outgrows 1 GB: e2-small in the same region ≈ ₹1,100, or keep the free VM and move n8n's DB to Postgres (`DB_TYPE=postgresdb`, see n8n docs) | 0 until then |
| Claude API at Phase-1 volume (≈ 40 inbox mails/day, one plan, one huddle): Haiku ≈ $0.01/day, Sonnet ≈ $0.25–0.40/day | ≈ $8–12 ⇒ the $100 credit lasts 8–12 months |
| WhatsApp | internal messages to the director/principal are free-form text inside Meta's 24-hour window; a template fallback (if configured) is a utility message, ≈ ₹0.12 each |

Watch spend in the table: `select date(created_at), sum(est_cost_usd) from office_ai_usage group by 1 order by 1 desc;`

## 2. Environment variables (`.env`)

Copy `.env.example`; never commit `.env` (already git-ignored).

| Variable | What it is | Where it comes from |
|---|---|---|
| `N8N_ENCRYPTION_KEY` | encrypts credentials inside n8n's DB. Losing it means re-entering every credential | `openssl rand -hex 24`, once; back it up with the VM |
| `ANTHROPIC_API_KEY` | **a dedicated key** named `n8n-office` | console.anthropic.com → API keys. Dedicated so it can be rotated or revoked alone, and so the usage dashboard shows the office on its own line |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | the ERP's Supabase project | Supabase → Project settings → API. The service-role key bypasses RLS; the workflows **read** ERP tables and **write only** `office_*` |
| `OFFICE_TENANT_ID` | the school's tenant uuid | see *Find OFFICE_TENANT_ID* below |
| `ERP_BASE_URL` | the ERP | `https://bhbinternational.school` |
| `WA_DISPATCH_SECRET` | the secret the ERP's `POST /api/wa/dispatch` route accepts in `x-wa-dispatch-secret` | the same value as on the Cloud Run service (`deploy/env.production.example`). WhatsApp goes out through that route, never straight to Meta |
| `DIRECTOR_WA_MOBILE`, `PRINCIPAL_WA_MOBILE` | 10-digit mobiles, no `+91` | the director approves drafts from this number; both get the 6 am plan |
| `OFFICE_WA_TEMPLATE`, `OFFICE_WA_TEMPLATE_LANG` | optional approved Meta **utility** template with one `{{1}}` body variable | Meta refuses free text to anyone who has not written to the school number in 24 h. With a template set, a refused message is resent as that template with the text as the variable. Leave empty to skip |
| `SCHOOL_INBOX` | the inbox the Receptionist reads | informational; the Gmail nodes use the OAuth credential below |
| `OFFICE_ROSTER` | who speaks at the huddle, in order | `receptionist,academic_incharge` — append to add an employee |

### Find OFFICE_TENANT_ID

Supabase → SQL editor:

```sql
select id from public.tenants where slug = 'bhb-international';
```

### Gmail OAuth (the Receptionist's inbox)

1. In GCP project `school-erp-prod-493619` → APIs & Services → enable **Gmail API**.
2. Credentials → *Create credentials* → OAuth client ID → Web application. Authorized redirect URI: the one n8n shows when you create the credential (`https://<your n8n host>/rest/oauth2-credential/callback`; with the SSH tunnel it is `http://localhost:5678/rest/oauth2-credential/callback`).
3. OAuth consent screen: Internal (Workspace) is fine; scopes `gmail.modify` (read + send + label).
4. In n8n → Credentials → *Gmail OAuth2 API*: paste client id/secret, *Sign in with Google* as the school inbox (`office@…`, not the director's own mailbox).
5. Open the Receptionist workflow, select that credential on **New mail in school inbox** and **Gmail: send approved reply**.

The redirect URI must match n8n's public URL exactly, so do this once the
tunnel or domain is settled.

## 3. Apply the migration, import the workflows

**Migration** (one-time, from a Mac with the Supabase CLI linked to the project; the repo's usual path):

```bash
supabase db push
```

or paste `supabase/migrations/20261021120000_office_staff_room.sql` into the SQL editor. It is additive and safe to re-run.

**Import** the three workflows. Either in the editor (*Workflows → Import from file*, one by one) or from the VM in one go:

```bash
docker compose exec n8n n8n import:workflow --separate --input=/office/workflows
```

(the compose file mounts `./workflows` read-only at `/office/workflows`). Then
in the editor: open each workflow, check the Gmail nodes have the credential,
run **Test workflow** once on the Academic Incharge (it only reads, writes
notes and messages the principal/director), and switch each one to **Active**.

Re-import after a change: import again and delete the old copy, or copy the
changed node into the live workflow. The JSON is generated — see section 6.

## 4. What each workflow does

### Receptionist (`workflows/receptionist.json`)

Two triggers in one workflow.

**A. New mail** (Gmail poll, every minute)

1. `Build: classify` → **Claude Haiku** classifies into `cbse / udise / vendor / parent / spam / other`, extracts a one-line summary, a deadline (if the mail states one) and the sender's language.
2. `Switch: by route`
   - **parent / vendor** → `Build: draft` → **Claude Sonnet** writes the reply in the sender's language (Hindi in Devanagari, or English) → the draft is inserted in `office_tasks` (`to_role = director`, `approval_state = pending`, the Gmail ids and the draft in `payload`) → the director gets it on WhatsApp:
     > ✉️ Draft #42 (parent, hi) … Tap Approve or Reject — or reply APPROVE 42 / REJECT 42.  **[Approve 42] [Reject 42]**

     One WhatsApp per draft, with two reply buttons (a draft longer than 1,000 characters goes out as text, then a short message carries the buttons). Outside the director's 24-hour window the same draft goes as the `bhb_office_approval` template with ✅ Approve / ❌ Reject quick replies — see §8.
   - **cbse / udise** → an `office_tasks` row for `academic_incharge`, with the deadline as `due_on`.
   - **everything else** (spam, other, items that need no reply, or a classification Claude could not produce) → an `office_notes` row.
3. `Build: run status note` writes one `office_notes` row per run: how many mails, how many drafts waiting, routed, filed.

**B. Director's decisions** (every 5 minutes)

Reads pending drafts, then the director's inbound WhatsApp texts and button
taps from `wa_messages` (the ERP logs every inbound message there; a tap is
logged as its label with the button id in `button_id`), matches
`Approve 42` / `Reject 42` — tapped or typed, also `ok`, `yes`, `haan`, `ठीक`,
`no`, `nahi`, `नहीं`; a bare `APPROVE` works when exactly one draft is pending. Approve → the reply
goes out through Gmail in the original thread → the task becomes
`approved / done` → the director gets "✅ Sent reply #42". Reject → `rejected /
cancelled`, "🚫 Draft #42 rejected". A reply that came in before the draft
existed is ignored, and each draft is decided once.

### Academic Incharge (`workflows/academic-incharge.json`)

06:00 IST. Reads, for today:

- approved `staff_leave_requests` covering today;
- today's `staff_attendance_desk_registers` row and its `_marks` with status `A` (absent), `L` (late), `LE` (left early) — if the register is not marked yet, the plan says so;
- `timetable_desk_slices` → `publishedGrids` (today's weekday only) and `substitutions` already saved for today;
- `sis_staff` (active), class/section/subject names from `masters_desk_*`;
- `masters_desk_holidays` for today (a holiday, or a Sunday, skips the plan and writes a one-line note);
- its own open `office_tasks` (`to_role = academic_incharge`).

`Assemble` turns that into: absent teachers with their periods, free teachers
per period, who teaches which subject today, blockers found in the data (no
published grid, register unmarked). **Claude Sonnet** returns the plan
(`proposed / already_arranged / uncovered` per period), blockers and
decisions for the director. Then: one `office_notes` row with the plan and the
counts in `facts`; one `office_tasks` row per decision (`to_role = director`,
`source = academic`); the plan to the principal and director on WhatsApp as a
plain internal message (no approval gate — it leaves nothing to a parent).

The ERP's own `/api/ai/substitution-summary` route stays as it is: it needs a
staff login and summarises a substitution the office already saved. This
workflow reads the same tables the timetable desk writes and never writes
them; arranging the substitution in the ERP remains the office's click.

### Morning huddle (`workflows/morning-huddle.json`)

06:30 IST.

1. Loads yesterday's and today's `office_notes` and every open `office_tasks` row.
2. **Chair** (Sonnet, `charters/chair.md`) sets a 3–5 item agenda, each item addressed to one role, plus a two-sentence opening.
3. `Loop over roster`: for each role in `OFFICE_ROSTER`, in order, one Sonnet call with **that role's charter as the cached system prompt** and the running transcript (opening + earlier turns) — the role answers its agenda items in ≤ 3 sentences each and may propose tasks.
4. **Chair** writes minutes and decisions; each decision is one role + one due date; unsettled questions go to `director`.
5. The whole meeting (agenda, transcript, minutes, decisions) is one `office_meetings` row; each decision becomes an `office_tasks` row (`source = huddle`); the director gets one WhatsApp:
   > 🧑‍🏫 Huddle 2026-10-22 • receptionist: … by 2026-10-23 • academic_incharge: … • director: …

## 5. Guardrails

- **No direct ERP writes.** The workflows write exactly four tables: `office_tasks`, `office_notes`, `office_meetings`, `office_ai_usage`. ERP data (timetable, attendance, leave, fees, admissions, students, staff) is read-only to them; a change there goes through the ERP's screens and authenticated routes, by a person. The service-role key is in n8n because PostgREST has no narrower key; the convention is enforced by review of `scripts/build-workflows.mjs`, where every `sbInsert` / `sbPatchTask` names its table.
- **Approval gate.** Anything addressed to a parent, a vendor, an official or the public is an `office_tasks` row with `approval_state = pending` and goes nowhere until the director taps **Approve** (or replies `APPROVE <id>`) on WhatsApp. Internal messages (the 6 am plan, the huddle minutes, acknowledgements) go to the director/principal only and are not gated.
- **WhatsApp only through the ERP.** `POST /api/wa/dispatch` with `x-wa-dispatch-secret`; the ERP applies opt-outs, the 24-hour rule and logs the message in `wa_messages`. No Meta token lives in n8n.
- **Grounding.** Every charter carries the house rule: say "not known" rather than invent a fee, a date, a student or a staff member. Prompts hand the model only the data the workflow fetched; a reply the model cannot structure is filed as a note, never sent.
- **Prompt injection.** Email bodies, notes and task text are content, not instructions — the house rules say so, and nothing an email says can reach a send without the director's APPROVE.
- **Models and cost.** `claude-haiku-5-5` for sorting, `claude-sonnet-5-5` for anything a human reads; charters are the cached system block (`cache_control: ephemeral`); every call lands in `office_ai_usage` with token counts and an estimated USD cost. Effort is `low` for classification and `medium` for drafting.
- **Secrets.** `.env` on the VM only; `.env.example` has placeholders; `N8N_ENCRYPTION_KEY` backed up with the VM. n8n is loopback-only behind an SSH tunnel until a tunnel/IAP front is set up.
- **Failure mode.** A failed Claude call retries three times; a failed WhatsApp send does not abort the run (the note/task is already written, and n8n shows the error). If the director never answers, a draft stays `pending` and the huddle raises it the next morning.

## 6. Adding the next employee

The pattern (Phase 2 will add the Marketing Manager, Counsellor and Transport Incharge this way):

1. **Charter.** Write `charters/<role>.md` with the same five headings as the existing ones: *Who you are*, *What you own*, *What you may decide alone*, *What needs the director*, *Output format*, plus *In the huddle*. Keep it 400–600 words: with the house rules it must pass Claude's 512-token minimum for the system block to be cached. Use the roster key as the role name everywhere (`transport_incharge`, not "Transport Incharge").
2. **Register it in the build.** In `scripts/build-workflows.mjs` add the role to `ROLE_CHARTERS` (`transport_incharge: systemFor("transport-incharge")`). That alone makes the huddle know the role: the `Roster` node accepts any roster key that has a charter, and `Build: turn` uses that charter as the cached system prompt.
3. **Roster.** Append the key to `OFFICE_ROSTER` in `.env` (`receptionist,academic_incharge,transport_incharge`) and `docker compose up -d` so n8n sees it. The huddle calls roles in that order.
4. **Its own workflow** (if it has a daily job). Copy the shape of `buildAcademicIncharge()`: a schedule trigger → `sbGet` reads (`executeOnce` + `alwaysOutputData`, so an empty table does not stop the chain) → one `Assemble` Code node that builds `request` with `claudeRequest(...)` → `claudeCall(...)` (adds the HTTP node, the parse node and the usage leaf) → a `Build: outputs` node that produces `note_row`, `task_rows`, `wa_text`, `wa_to` → `sbInsert` + `waChain`. Register the file in `builds` at the bottom. Anything outward goes through an `office_tasks` row with `approval_state: 'pending'` and the director's WhatsApp, as the Receptionist does; the approval poll in `receptionist.json` only sends Gmail replies, so a role whose approved action is different (a WhatsApp to a parent, a Google Ads budget change) needs its own small "decisions" branch — copy *B. Director's decisions*, filter on `source = '<role>'`, and replace the Gmail node with the action.
5. **Build, check, import.**

   ```bash
   node automation/n8n/scripts/build-workflows.mjs
   node automation/n8n/scripts/check-workflows.mjs
   ```

   then import the changed JSON (section 3). `check-workflows.mjs` fails if a charter in the JSON is stale, a Code node does not parse, a model id is wrong, or a Claude call has no usage-ledger leaf.
6. **Migration?** Usually none: new roles use the same four tables. Add a new `source` value to the `office_tasks.source` check constraint only when a role needs its own.

## 7. Deployed instance (21 Oct 2026)

| | |
|---|---|
| VM | `office-n8n`, `us-central1-a`, e2-micro, 30 GB pd-standard, Debian 12, Docker 29 + Compose v5, 2 GB swap (Always Free tier) |
| n8n | 2.44.5, loopback `127.0.0.1:5678`, SQLite; the three workflows are imported (inactive) |
| Folder on the VM | `~/office` (a copy of this folder; `.env` has `N8N_ENCRYPTION_KEY` and `OFFICE_TENANT_ID` filled) |
| Supabase | migration `office_staff_room` applied to project BHB School; tenant id `6558f3c4-6d12-4636-bf53-17423b0eaad3` |
| ERP | `WA_DISPATCH_SECRET` is bound on Cloud Run from Secret Manager secret `school-erp-wa-dispatch-secret` |

Still to do by hand (secrets are never written by automation):

```bash
gcloud compute ssh office-n8n --project=school-erp-prod-493619 --zone=us-central1-a
nano ~/office/.env   # fill ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY, WA_DISPATCH_SECRET, DIRECTOR_WA_MOBILE, PRINCIPAL_WA_MOBILE
```

The two ERP values come from Secret Manager (run on the Mac, paste into nano):

```bash
gcloud secrets versions access latest --secret=school-erp-supabase-service-role-key --project=school-erp-prod-493619
```

```bash
gcloud secrets versions access latest --secret=school-erp-wa-dispatch-secret --project=school-erp-prod-493619
```

`ANTHROPIC_API_KEY` is a new key named `n8n-office` from console.anthropic.com. Then on the VM `cd ~/office && sudo docker compose up -d` (re-reads `.env`), open the SSH tunnel (section 1), create the owner account at <http://localhost:5678>, add the Gmail OAuth2 credential (section 2) and select it on the two Gmail nodes, run **Test workflow** on the Academic Incharge, and activate all three.

To update the workflows after a change in this repo: `gcloud compute scp --recurse automation/n8n/workflows office-n8n:~/office/ --zone=us-central1-a`, then `sudo docker compose exec -T n8n n8n import:workflow --separate --input=/office/workflows` and delete the older copies in the editor (import creates new workflows, it does not replace).

## 8. Files

```
automation/n8n/
├── docker-compose.yml        n8n alone (SQLite on a volume); loopback only; env passthrough for the workflows
├── .env.example              every variable, placeholders only
├── README.md                 this file
├── charters/
│   ├── _house-rules.md       prepended to every role: grounding, who decides, tone, safety
│   ├── receptionist.md
│   ├── academic-incharge.md
│   └── chair.md
├── scripts/
│   ├── build-workflows.mjs   charters + helpers → workflows/*.json (no dependencies)
│   └── check-workflows.mjs   static checks; run before importing
└── workflows/
    ├── receptionist.json
    ├── academic-incharge.json
    └── morning-huddle.json
```

Validation done on 21 Oct 2026: `check-workflows.mjs` passes; the three JSON
files import into a local n8n 2.44.5 (`n8n import:workflow --separate`) and
export back with the same nodes, connections and timezone; every Code node
was also executed against sample data (three mails, two absent teachers, a
two-role huddle, APPROVE/REJECT in English and Hindi); the migration applies
twice on a throwaway Postgres 16 with the repo's grant convention. Docker was
not available on the build Mac, so `docker compose config` is the first
thing to run on the VM; the compose file was parsed and its `${VARS}`
cross-checked against `.env.example` instead.

## 8. Approval buttons and the `bhb_office_approval` template

The director decides a draft with a tap. Inside Meta's 24-hour window
(the director wrote to the school number within a day) the Receptionist
sends the draft through `POST /api/wa/dispatch` with
`buttons: [{ id: "approve-42", title: "Approve 42" }, { id: "reject-42", title: "Reject 42" }]`
— Meta's interactive reply buttons. A tap reaches the ERP webhook, which logs
it in `wa_messages` as `body = "Approve 42"`, `button_id = "approve-42"`,
`kind = "button"`; the 5-minute poller reads either column.

Outside the window Meta refuses free text and buttons alike. The dispatch
result then carries `windowClosed: true` and the chain resends the draft as
the template named by `OFFICE_WA_APPROVAL_TEMPLATE`:

- body `✉️ Draft #{{1}} from the school office needs your decision.\n\n{{2}}`;
- two QUICK_REPLY buttons, ✅ Approve / ❌ Reject, sent with the payloads
  `Approve 42` / `Reject 42` (`quickReplyPayloads`), so the tap arrives
  with the draft number even though the label carries none.

**Getting the template approved.** It is seeded in the ERP as
`staff_office_approval` (`apps/web/src/lib/waTemplates.ts`, Meta name
`bhb_office_approval`, en + hi). The ERP's template autopilot submits every
seeded utility template that has never been sent to Meta, hourly, so after
the ERP release that carries the seed it appears in **Masters → WhatsApp
templates** as *pending* and turns *approved* when Meta clears it (usually
within the hour; a status webhook updates the desk). Nothing to do unless it
is still *draft* after a day — then, in the templates desk, open *Office
draft needs a decision* and press **Submit to Meta**. For a submission by
hand (Meta Business Suite → WhatsApp Manager → Message templates → Create),
`charters/office-approval-template.json` is the exact payload for both
languages. Until the template is approved the chain falls back to
`OFFICE_WA_TEMPLATE` (the school notice) and the director types
`APPROVE 42` as before.

**Needs the ERP release with** `apps/web/src/lib/waReplyButtons.ts` (dispatch
`buttons` / `quickReplyPayloads`, `windowClosed`) and the migration
`20261022090000_wa_messages_button_id.sql` applied to the database before
this workflow is imported — the poller selects `button_id`.
