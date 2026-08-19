# AI in marketing & admissions — what exists, what's missing, build order

Audit date: 2026-08-19. Audited against the live codebase (`apps/web/src`) after the AI roadmap (`docs/AI_ROADMAP_2026-08.md`) closed. Companion to that doc: the substrate it built (router, budget, cache, outcome reporting, grounding gates, Sarvam, household prefs) is assumed here and not re-listed.

Legend: ✅ exists and works · 🟡 partial / foundations exist · ❌ missing

Standing rules for everything below (same as the AI roadmap, restated because marketing is where they are most tempting to break):
- **Every number, result, achievement, quote comes from ERP data.** The prompt gets facts; the model gets no licence to fill gaps. "Unknown must not become fact."
- **Every public-facing text is a draft** until a human accepts it (outcome `accepted` via `reportAiOutcome`). Nothing auto-publishes to social, website or print.
- **Prospects are not enrolled families** — separate store (`admissions.ts`), separate bot (`waCrmBotServer.ts`), separate widget (`crmParentChat.ts`). Keep it that way; add DPDP consent text where prospect data is captured.
- **A real person owns every serious lead.** AI handles speed and information; handoff to a counsellor stays the default past "warm".

---

## 0. What the platform already has (the funnel substrate)

| Capability | Status | Where |
|---|---|---|
| Lead model: enquiry → registration → verified → enrolled, household (one mobile, many guardians, many children), counsellor assignment, follow-ups with channel/outcome/bucket, lost reasons | ✅ | `lib/admissions.ts` (4.4k lines), `AdmissionsWorkspace.tsx` (10 tabs) |
| Capture channels: website enquiry form, family register (tokenised), Google Ads lead-form webhook, WhatsApp CRM bot (keyword flows + partial-lead capture), field survey (beats, offline queue, photos), walk-in desk, CSV/Excel import, staff-mobile enquiry | ✅ | `PublicEnquiryForm`, `publicAdmissionRegistration.server.ts`, `googleLeadForm.server.ts`, `admissionsLeadIngest.server.ts`, `waCrmBotServer.ts`, `fieldSurvey.ts`, `admissionsExcelImport.ts` |
| Lead sources enum (walk_in · website · google · social · field_survey · referral · phone · whatsapp · other) + `campaignNote` + `referredByStaffId` | ✅ | `ADMISSION_SOURCES` |
| Conversion-likelihood score (heuristic, pure) + AI next-best-action | ✅ | `lib/admissionsAi.ts`, `POST /api/ai/lead-next-action` |
| WA campaigns: audience lists with filters, scheduling, queue, dispatch, 4 templates (registration_invite · fee_reminder · open_day · custom), quiet-hours deferral | ✅ | `lib/waCampaigns.ts`, `AdmissionCampaignsPanel.tsx`, `/api/wa/dispatch` |
| CRM parent chat widget + staff inbox, thread status open/bot/needs_staff/closed | ✅ | `lib/crmParentChat.ts`, `CrmParentChatWidget.tsx`, `AdmissionCrmChatInbox.tsx` |
| WA CRM bot LLM fallback — **deliberately blind** to fees/dates/curriculum (grounded only in the lead's own record + register link) | ✅ by design | `tryAiFallbackReply` in `waCrmBotServer.ts` |
| Document OCR → lead fields (Gemini vision, 15 fields + `missing[]`) | ✅ | `/api/ai/application-extract`, `AdmissionDocOcrPanel.tsx` |
| Admission documents: offer letter, fee-structure letter, welcome packet (prefilled from lead + published NEW-admission fee lines) | ✅ | `schoolDocumentAi.ts` presets, `admissionDocumentLinks.ts` |
| Events with WA RSVP | ✅ | `lib/events.ts`, `waEventsRsvp.server.ts` |
| Social cross-post (Facebook Page + Instagram Business) of **notices** with composed caption | ✅ | `socialCrossPost*.ts`, `socialIntegrations.server.ts` |
| School KB (pgvector RAG) | 🟡 | `schoolKb.server.ts` — **published notices only**; CRM bot does not read it |
| Compliance / school facts (infra, safety certs, training, committees) | ✅ (2026-08-19) | `lib/complianceFacts.ts` — reusable as a USP fact source |
| Household language/channel/quiet-hours prefs, Sarvam translate, LANG flow | ✅ for **enrolled** families only | `householdPrefs.ts`, `sarvam.server.ts` — admission leads have no language field |
| WA template drafting (AI) | ✅ | `/api/ai/wa-template-draft` — drafts Meta *templates*, not per-lead messages |
| Reports: funnel counts, source counts, registration queue | ✅ | `funnelCounts`, `sourceCounts`, `AdmissionReportsPanel.tsx` |

---

## 1. Admissions knowledge base — the prerequisite for everything else

| | |
|---|---|
| Status | ✅ shipped 2026-08-19 — Admissions → **Knowledge base** tab (`lib/admissionsKb.ts`, module state `admissions_kb`): typed entries by kind (fees · process · documents · dates · transport · scholarship · USP · faculty · FAQ · policy), class scope, valid-till, public-safe flag; "Import fees from masters" copies the published NEW-admission lines verbatim (`kbEntriesFromFeeMasters`); "Sync to AI" (`POST /api/ai/kb-sync {source:"admissions_kb"}`) embeds live entries into `school_kb_chunks` with `source_type=admissions_kb`, `audience=prospects` (never returned to the SIS parent bot / ERP chat, which query other audiences). `POST /api/ai/admissions-answer` (public, mobile + per-IP limit) and the WA CRM bot both call `answerAdmissionsQuestion()` — retrieve top-5 prospect chunks (non-Latin questions translated to English via Sarvam for retrieval, answered in Hindi), `generateAdmissionsAnswerJson` with the hard grounding gate (`grounded`, `sources[]`; ungrounded → fixed HUMAN handoff, model text discarded), cacheable. Free-text questions go KB-first in both channels (exact keywords / buttons / greetings keep the canned replies); the widget appends the grounded answer (`postCrmParentMessageWithReply`). Unanswered questions are recorded server-side (`admissions_kb_gaps`, deduped with counts) and shown in the tab with Answer / Dismiss; "Ask as a parent" tests the live index. Verified end-to-end on prod (entry → sync → grounded EN + HI answers, ungrounded fee question → handoff + gap, widget answer) and cleaned. Selftest `test:admissions-kb`. Also fixed the CRM keyword matcher (`rs` matched "pape**rs**") |
| Was | 🟡 |
| Have | KB infra (embeddings, chunks, retrieval with 0.45 floor) but only notices indexed. Fee structures exist in fee masters; admission process/documents/dates live in people's heads or the website; compliance facts module holds infra/safety; masters hold classes/sections/transport routes |
| Missing | A **structured, staff-maintained admissions fact store**: fee by class (NEW admission lines), admission process steps, documents required (by class / by RTE), key dates & deadlines, transport routes + stops, scholarship / concession criteria, USPs (ratio, labs, sports, boards results), faculty profiles (public-safe subset), FAQs with approved answers. And: neither the CRM bot nor the chat widget reads any of it |
| Build | `lib/admissionsKb.ts` (module_local_state `admissions_kb`, same pattern as `compliance_facts`): typed sections + free FAQ list + `publicSafe` flag per entry. Admissions → **Knowledge base** tab. `schoolKb.server.ts` gains sources `admissions_kb`, `fee_structure` (from published fee masters), `transport_routes`; "Sync to AI" indexes them. `tryAiFallbackReply` + a new widget endpoint `POST /api/ai/admissions-answer` retrieve top-k chunks and answer **only from retrieved text** (the grounding gate from `generateParentBotReplyJson` reused: cite the chunk ids, refuse when none). Every answer logged to `ai_generations` with route `admissions-answer`; staff inbox shows "answered from KB" vs "escalated" |
| Guardrail | Fees/dates come from the store, never from the model; any "I'm not sure" → HUMAN handoff exactly as today |
| Data | New `admissions_kb` module state (desk-synced); no new tables |
| Model | Gemini Flash, cacheable by (question hash × KB version); budget counts per phone |
| Effort | ~3 days |

---

## 2. Funnel automation

### 2a. Lead enrichment from unstructured input
| | |
|---|---|
| Status | ❌ (image/PDF path ✅) |
| Have | `application-extract` for documents; WA bot captures name/class via keyword prompts |
| Missing | Paste an email / WA thread / call note → structured lead (parent name, child, class sought, source, medium, transport interest, urgency, concerns[]) |
| Build | `POST /api/ai/lead-extract` → `{ fields, concerns[], missing[] }`; "Paste enquiry text" on the walk-in enquiry tab and the lead panel; writes only fields the user ticks. `concerns[]` saved on the lead (new field `concerns: string[]`) — this is what later follow-ups reference |
| Effort | ~1 day |

### 2b. Dynamic public enquiry form
| | |
|---|---|
| Status | ✅ shipped 2026-08-19 — `lib/admissionsEnquiryForm.ts` (pure: `isSeniorClassName`, `enquiryQuestionsFor`, `LEAD_CONCERNS`, `PREVIOUS_BOARDS`, `dpdpNoticeText`; selftest `test:admissions-enquiry-form`). `/apply`: Class VI+ reveals previous board + previous school; transport interest; language for school messages (`HOUSEHOLD_LANGUAGES`); "What matters most" concern chips; RTE/EWS tick; **DPDP consent box required** → `parentConsentAt/By` + `declarationAccepted`; `?c=<campaign>` → `campaignId`. `/register` (local + tokenised server path): language + required consent. New `AdmissionLead` fields (`campaignId`, `preferredLanguage`, `previousBoard`, `concerns[]`, `referredByHouseholdId`) default to ""/[] — never guessed — live in `lead_json` (no migration); Google lead webhook maps `campaign_id` → `campaignId`. CRM lead panel: **Family preferences & attribution** card (language, board, concern chips, campaign id, consent status). Not done: WA bot asking prospects their language (LANG flow is enrolled-only) |
| Was | ❌ |
| Build | Deterministic branching (no model needed): class ≥ 6 → previous board + last result; any class → medium; transport interest → locality/stop; RTE eligibility question. Add `preferredLanguage` (from `HOUSEHOLD_LANGUAGES`), `previousBoard`, `locality` to `AdmissionLead`. DPDP consent line + checkbox on `PublicEnquiryForm` / `PublicFamilyRegisterForm` |
| Effort | ~1 day |

### 2c. Lead quality — hot / warm / cold with engagement signals
| | |
|---|---|
| Status | ✅ shipped 2026-08-19 — `lib/leadQuality.ts`: `leadEngagementSignals` (WhatsApp contact via bot-stamped wa id, chat-widget parent messages by mobile, logged replies, payment started/paid, told concerns/language), `leadQuality` = conversion heuristic + capped engagement bump → hot / warm / cold (**unknown = warm, never cold**; lost/enrolled/not-interested = cold). CRM: quality chip with signal tooltip, **Hot** and **Stalled** counsellor-queue filters; selftest `test:lead-quality`. Not done: campaign delivered/read signals (no BSP webhook → statuses are queued/sent/failed only), event RSVPs (server table) |
| Was | 🟡 |
| Have | `leadConversionScore` heuristic (stage, age, follow-up outcomes) |
| Missing | Engagement inputs: WA bot replies, campaign message delivered/read/replied, widget threads, event RSVPs, registration link opened, payment started. Label hot/warm/cold surfaced on the list |
| Build | Extend the heuristic (keep it rules, not a model) with a `leadEngagement` view built from `waCampaigns` message statuses, `crmParentChat` threads, `event_rsvps`, registration link token use. Add `quality: "hot"\|"warm"\|"cold"` computed, filterable in the CRM list and usable as an audience filter |
| Effort | ~1.5 days |

### 2d. Per-lead AI follow-up drafts, in the parent's language, per channel
| | |
|---|---|
| Status | ✅ shipped 2026-08-19 — `lib/leadFollowupAi.ts` (facts · prompts · parser · `followupUngroundedNumbers` digit check · language routing: en/hi direct, bn/ur/mai drafted in Hindi then Sarvam; selftest `test:lead-followup-ai`), `generateLeadFollowupJson` (route `lead-followup-draft` v1), `POST /api/ai/lead-followup-draft` (admissions view; adds prospect-KB snippets for the lead's `concerns[]`), `LeadFollowupDraftPanel` in the CRM lead panel: tone, language (defaults to the lead's), note, WhatsApp / SMS / email / call-script tabs, "check numbers not in the facts" warning, Copy, **Open WhatsApp & log** (new follow-up outcome `message_sent`), Log as sent / Log call. Verified on dev against prod data: Hindi draft referencing the bus question + Saturday visit, no invented fees; Bengali via Sarvam |
| Was | ❌ (next-action ✅ tells *what*, not *the words*) |
| Build | `POST /api/ai/lead-followup-draft` — input: lead facts (child, class sought, stage, days since enquiry, `concerns[]`, last 3 follow-ups, admissions-KB snippets that answer the concerns), tone, channel (`whatsapp`/`email`/`sms`/`call_script`), language. Output JSON per channel. Lead panel "Draft follow-up" → edit → "Log & send" logs the follow-up and opens wa.me / copies; Sarvam for regional languages via `sarvamTargetFor`. `preferredLanguage` on the lead (2b) drives the default |
| Guardrail | Facts only from lead + KB; the prompt lists what it may not claim (seat availability, discounts) unless present in KB |
| Effort | ~2 days |

### 2e. Nurture sequences (drip)
| | |
|---|---|
| Status | ✅ shipped 2026-08-19 — `WaSequence` (steps: day offset · time · label · template · body; anchor = start day or an event date) in `waCampaigns.ts`; WA campaigns → **Sequences** tab with presets (open house −7/−1/+1, enquiry nurture 0/4/9, result day 0/+3, festival greeting); **Start** creates one scheduled campaign per step (`sequenceId`/`sequenceStep`) through the existing `createCampaign`/`scheduleCampaign` → queue → dispatch; **Stop** pauses + skips; `pruneSequenceQueue` runs before every dispatch and skips families who enrolled / were lost / said not interested (STOP already enforced at send by `waSend`). Step bodies: "Draft with AI from school facts" → `marketing-content` (`wa_broadcast` / `event_invite` / `greeting`) with the public achievements + positioning + occasion, placeholders preserved; every body editable before Start. Selftest `test:wa-sequences` |
| Was | ❌ (one-shot campaigns ✅) |
| Build | `WaSequence { steps: { dayOffset, templateKey\|customBody, condition }[] }` in `waCampaigns.ts`; enrol an audience list; `dispatchDueCampaigns` already runs on a schedule — extend it to materialise the next step per lead, skipping leads whose stage advanced or who replied STOP. Step bodies can be AI-drafted **from ERP facts** (§3a) — "how Class 9 did", "a day in Class 3", "meet the Science faculty" — all rendered from data the school entered, each step human-approved once per sequence |
| Data | New `sequences` + `sequence_enrolments` keys in the campaigns state (desk slice) |
| Effort | ~3 days |

---

## 3. Data-driven marketing content

### 3a. Results / achievements → multi-format assets
| | |
|---|---|
| Status | ✅ shipped 2026-08-19 — Admissions → **Marketing** tab. `lib/schoolAchievements.ts` (module state `school_achievements`): achievements by kind (board result · competition · sports · recognition · alumni · facility · event) with session, date, detail, **named metrics** ("Pass %: 100") and source note, public-safe flag; positioning notes (our strengths · what others advertise · blocked competitor names · brand lines). `lib/marketingContentAi.ts` + `generateMarketingContentJson` (route `marketing-content`, pro tier for brochure/press) + `POST /api/ai/marketing-content`: 8 formats (social post · brochure paragraph · press release · website banner · WA broadcast · referral invite · event invite · greeting), en/hi direct, regional via Sarvam, one variant per language. `lib/aiGrounding.ts`: `ungroundedNumbers`, `forbiddenNameHits`, `sensitiveClaims` — every variant carries flags; competitor-name hits **cannot be accepted**; cross-post (new kind `marketing` → `/apply?src=social`) only after Accept. Selftest `test:marketing-content-ai`. Verified on dev: EN+HI social post from a board-result fact — all numbers grounded, "100% pass" flagged for human review |
| Was | ❌ |
| Have | Exam results per term (internal); board results and achievements have **no structured store**; social cross-post exists for notices |
| Build | `lib/schoolAchievements.ts` (module state): board results per year (pass %, distinctions, subject toppers — typed by staff from the CBSE result, never generated), competition wins, sports, alumni notes, each with `publicSafe` + source note. `POST /api/ai/marketing-content` — input: selected achievement facts + asset kind (`social_post`/`brochure_para`/`press_release`/`website_banner`/`wa_broadcast`) + language + audience tone. Output per kind; shown in a "Marketing" tab with Copy / Cross-post (reuses `socialCrossPost` with staff approval) / Send as broadcast |
| Guardrail | Numbers are interpolated from facts, not written by the model; a ratchet-style selftest asserts no digit in the output is absent from the facts. Human review step before any cross-post (CBSE ad norms on "100%"/rank claims) |
| Model | Gemini Flash; Pro for long brochure copy |
| Effort | ~3 days |

### 3b. Competitor-aware positioning
| | |
|---|---|
| Status | ✅ shipped 2026-08-19 — positioning notes in the Marketing tab; "Differentiate vs what others advertise" toggle; prompt forbids naming; `forbiddenNameHits` blocks acceptance |
| Was | ❌ |
| Build | Small `positioning` section in the admissions KB: our USPs (from compliance facts + achievements + masters: ratio, labs, transport, sports) and a staff-entered list of nearby schools' publicly advertised points. `marketing-content` takes `positionAgainst: true` to emphasise differences — **never names or disparages a competitor in output** |
| Effort | ~0.5 day on top of 3a |

### 3c. Localised variants
| | |
|---|---|
| Status | ✅ shipped 2026-08-19 — up to 4 languages per generation (en/hi written; bho→hi; bn/ur/mai via Sarvam from the Hindi draft), warm/formal register |
| Was | 🟡 (Sarvam ✅, no marketing use) |
| Build | `marketing-content` accepts `audiences: [{ language, register: "formal"\|"warm" }]` and returns variants; Sarvam for bn/ur/mai. Festival/occasion greetings (§6c) share this |
| Effort | ~0.5 day |

---

## 4. Admissions communication hub

| Item | Status | Build |
|---|---|---|
| Instant contextual first response | 🟡 | On new lead (any channel): `lead-followup-draft` auto-runs a "first response" in the lead's language and queues it as a **suggested** message for the counsellor (one-click send), or — if the school opts in per source — sends immediately for website/Google leads within 5 min via the dispatch worker. Log as follow-up channel `whatsapp`, outcome `sent_auto` |
| Smart FAQ engine | 🟡 → ✅ via §1 | KB-grounded answers in bot + widget; unanswered questions surface as a "KB gaps" list for staff to add approved answers |
| Virtual assistant on portal | 🟡 | Widget gains `admissions-answer`; logs every thread (already), auto-routes to `needs_staff` when quality is hot or question is outside KB |
| Document guidance / deficiency | 🟡 | Per-class documents list in KB (§1) + OCR `missing[]` → "Documents still due" checklist on the lead; new preset `admission_deficiency` (what is missing, how to submit, by when) alongside `admission_offer` |

Effort: ~2 days after §1.

---

## 5. Referral & testimonial engine — ✅ shipped 2026-08-19

| | |
|---|---|
| Shipped | `lib/referrals.ts` (module state `referrals`): **referral codes** derived deterministically per enrolled household (`BHB-XXXX-000`, `referralCodeFor`/`resolveReferralCode` — no lookup table, an old flyer still resolves); `?ref=CODE` on `/apply` sets `lead.referralCode` + source `referral`; CRM lead panel "Referred by" field resolves to `referredByHouseholdId`; `referralAttribution` (leads → registered → enrolled per referrer); Admissions → **Referrals & stories** tab: per-household code, Invite (WhatsApp, message drafted from school facts via `marketing-content` kind `referral_invite` with `{{guardianName}} {{code}} {{link}}`), Copy link, invited-at, reward note (informational only). **Testimonials**: Ask for story (WA) → paste the parent's words → `POST /api/ai/testimonial-polish` (grammar/flow only; guard `testimonialPolishProblems` refuses added numbers, growth > 20 %, over-cutting; polish with problems cannot be kept) → Send for approval (WA) → Mark approved with consent note + name permission → `approvedTestimonialLines` offered to the Marketing generator ("Quote approved parent stories"). Selftest `test:referrals`. Not done: WA inbound `STORY` keyword capture (manual paste instead) |
| Have | `referral` source, `referredByStaffId` (staff only) |
| Build | **Referral**: `referredByHouseholdId` on the lead + a referral code per enrolled household (`householdPrefs`-adjacent); referral invite broadcast (audience: enrolled parents, language-aware, quiet-hours gated) drafted by `marketing-content` kind `referral_invite`; attribution in the admissions report (referrals → registrations → enrolments per referrer); reward tracking as a note field — money movement stays manual. **Testimonials**: `lib/testimonials.ts` module state — request sent to parents identified from PTM feedback / surveys (opt-in), raw reply captured (WA inbound keyword `STORY` or portal form), `POST /api/ai/testimonial-polish` returns a tidied version **preserving the parent's words and claims only**, parent approves (WA YES / portal), then `approved` → usable by 3a. Consent recorded with timestamp |
| Guardrail | No testimonial is generated; polish = grammar/length only; diff shown to staff; unapproved never leaves the module |
| Effort | ~3 days |

---

## 6. Retention & win-back

| Item | Status | Build |
|---|---|---|
| 6a. Stalled-lead alerts + re-engagement draft | ✅ 2026-08-19 — `stalledLeadFlags` rules: paid-not-completed (14 d), went-quiet after interest (10 d), digital enquiry not reached (3 d), no follow-up (5 d); each carries a facts-only **hook**; Dashboard KPI "Stalled leads" with detail rows (why · days · quality); lead panel shows the reason and feeds the hook into the follow-up draft. Thresholds are code defaults (`DEFAULT_STALLED_THRESHOLDS`) — not yet in admissions policy UI | Rules in `admissionsAi.ts`: form completed & no reply in N days; registration fee paid & admission not completed; enquiry with no follow-up in N days. Flagged list on the Dashboard tab; "Draft re-engagement" → `lead-followup-draft` with `hook` = open house (from `events`), deadline (KB dates), scholarship (KB criteria) — hook chosen by rule, text by model. Thresholds in admissions policy |
| 6b. Post-admission churn → retention outreach | 🟡 (at-risk ✅ academic) | At-risk flags (`academicRisk.ts`) + fee overdue + attendance drop → "retention watch" list for the principal; draft parent outreach through the existing `at-risk-notes` style route, sent via household-pref channel/language. Not a new AI route — a new consumer of existing ones |

Effort: ~2 days.

---

## 7. Event-driven marketing

| Item | Status | Build |
|---|---|---|
| 7a. Open house / tour campaigns | ✅ 2026-08-19 — Sequences preset "Open house / school tour" anchored on the event date (invite −7 d, reminder −1 d, thank-you +1 d), bodies drafted from facts via `event_invite` | Event → "Generate campaign": invite, 2 reminders, thank-you + next step, all `marketing-content` kinds with the event facts; lands as a sequence (§2e) on a chosen audience list |
| 7b. Result-season announcements | ✅ 2026-08-19 — Marketing tab: board-result achievement → social post / banner / press release / WA broadcast (accept → cross-post); Sequences preset "Result-season announcement" (day 0 + day 3 CTA) | Achievements entry (§3a) → one click → social post + WA broadcast + website banner copy in en/hi; human approve → cross-post |
| 7c. Festival / occasion greetings | ✅ 2026-08-19 — Marketing kind `greeting` (no selling, one brand line) + Sequences preset "Festival / occasion greeting" anchored on the date; quiet hours still gate the send | Calendar of occasions (from holiday master + a small editable list) → greeting drafts per language, subtle brand line, scheduled as campaigns, quiet-hours gated |

Effort: ~2 days after 3a and 2e.

---

## 8. ERP foundations still needed

| Need | Status | Work |
|---|---|---|
| Lead fields: `preferredLanguage`, `previousBoard`, `locality`, `concerns[]`, `quality`, `utm`/`campaignId`, `referredByHouseholdId`, `consentAt` | 🟡 (2026-08-19: all but `quality` added; `locality`/`parentConsentAt` already existed) | `AdmissionLead` + `normalizeAdmissionLead` (all default `""`/`[]` — never guessed); Google lead webhook already carries campaign ids → map to `campaignId` |
| Unified communication timeline per lead | 🟡 (3 stores) | Read-only merge view in the lead panel: follow-ups + WA bot thread + campaign messages + widget thread, chronological; the same merge feeds `lead-followup-draft` as "last 5 touchpoints" |
| Marketing asset library | 🟡 (2026-08-19: brand lines in Marketing → Positioning; no image library yet) | generators reference brand lines, not images |
| School knowledge base (admissions) | 🟡 | §1 |
| Achievements store | ✅ 2026-08-19 | §3a |
| Campaign attribution & reporting | 🟡 | `campaignId` on lead → report: leads / registrations / enrolments per campaign & source, cost field per campaign (manual), cost per enrolment; a `leadership-digest` style AI summary of "where to focus" is optional and last |
| DPDP notice | 🟡 (2026-08-19: consent text + required checkbox on `/apply` and `/register`, `parentConsentAt/By` stored, status shown in the lead panel; bot first-contact notice still to do) |

---

## 9. Guardrails specific to marketing — what to enforce in code

1. **Digit check**: every `marketing-content` / `testimonial-polish` output passes a selftest-backed check that each number in the output appears in the supplied facts; otherwise the draft is marked "needs review" and the offending number highlighted.
2. **No publish without accept**: cross-post and broadcast buttons are disabled until `reportAiOutcome(accepted)` has run for that generation.
3. **KB-only answers** for prospects: `admissions-answer` returns `grounded: false` + handoff when retrieval is empty; logged; a weekly "unanswered questions" list becomes the KB backlog.
4. **No competitor naming** in output (regex on the competitor list).
5. **Prospect data stays in the admissions store**; no merge into SIS until enrolment (existing `admissionsSisReconcile` path).
6. **Human handoff** rule: `quality === "hot"` or any fee/negotiation question → `needs_staff`, counsellor notified; bot says a person will call.

---

## 10. Suggested build order (impact ÷ effort)

1. ~~**§1 Admissions KB + grounded bot/widget answers**~~ — shipped 2026-08-19.
2. ~~**§8 lead fields + DPDP consent + §2b dynamic form**~~ — shipped 2026-08-19 (WA-bot language ask + bot DPDP line deferred).
3. ~~**§2d per-lead follow-up drafts, language + channel**~~ — shipped 2026-08-19.
4. ~~**§2c engagement-aware hot/warm/cold + §6a stalled-lead rules & drafts**~~ — shipped 2026-08-19.
5. ~~**§3a achievements store + marketing-content generator (+3b, 3c)**~~ — shipped 2026-08-19.
6. ~~**§2e sequences + §7 event/result/festival campaigns**~~ — shipped 2026-08-19 (no automatic occasion calendar — the office sets the date).
7. ~~**§5 referral + testimonials**~~ — shipped 2026-08-19.
8. **§8 unified timeline + attribution report** (~2 d).
9. **§2a free-text lead extraction, §4 deficiency preset, §6b retention consumer** (~2.5 d).

Total ≈ 25 working days. Items 1–4 (~9 d) are the "single admission cycle" ROI set.
