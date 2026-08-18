# AI in daily school operations — what exists, what's missing, which model

Audit date: 2026-08-18. Audited against the live codebase (`apps/web/src`), production Supabase, and the Cloud Run config. Organised by where AI delivers the most impact in a CBSE school's day.

Legend: ✅ exists and works · 🟡 partial / foundations exist · ❌ missing

---

## 0. What the platform already has (the AI substrate)

| Capability | Status | Where |
|---|---|---|
| Central LLM router, server-only, RBAC-gated, auto-failover | ✅ | `lib/aiLlm.server.ts` — Gemini primary (`gemini-3.6-flash`, set 2026-08-18), OpenAI fallback (`gpt-4o-mini`) |
| 17 AI endpoints (all `POST /api/ai/*`, staff-only) | ✅ | exam-paper, tutor, school-document, student-certificate, staff-agreement, homework-grading-assist, collections-draft, lead-next-action, wa-template-draft, leadership-digest, fleet-director-report, ptm-feedback-digest, thread-summary, appraisal-comment-draft, substitution-summary, automation-setup, kb-sync |
| ERP assistant chat (staff) + WhatsApp parent/admissions bots with LLM fallback | ✅ | `lib/erpAiChat*.ts`, `lib/waCrmBotServer.ts`, `lib/waChatbotFlows.ts` |
| RAG over school corpus (pgvector) | 🟡 | `lib/schoolKb.server.ts` — indexes **published notices only**; embeddings are OpenAI `text-embedding-3-small`; staff-triggered "Sync to AI" |
| OCR | ✅ | Google Vision (`lib/googleVision.server.ts`) — homework grading assist, procurement OCR, syllabus OCR, WA inbound media (Aadhaar/birth cert/payment proof) |
| Speech / voice | ✅ | Web Speech + Google Speech fallback, EN-IN / HI-IN (`lib/voiceLanguages.ts`, `lib/googleSpeech.server.ts`); parent voice intents; IVRS flow |
| Bilingual output | 🟡 | WA templates `en`/`hi`; school documents `en`/`hi`/`both`; ERP chat answers in user's language (EN/HI). **No regional language, no per-family preference** |
| AI provenance flags | 🟡 | `aiDrafted` on certificates + staff agreements; `source: "manual"\|"ai"\|"bank"` on exam questions. **Nothing on remarks, messages, notices** |
| Audit log table | ✅ | `audit_events` (Phase 2) — not yet used for AI generations |
| Rate-limit / usage log / cache / prompt versioning for AI | ❌ | only Maps has a rate limiter; prompts are inline string literals in code |

---

## 1. Assessment & Report Card Engine — highest ROI, biggest gap

### 1a. Auto-generated report card remarks
| | |
|---|---|
| Status | ✅ shipped 2026-08-18 — Exams → Remarks tab, `POST /api/ai/report-remarks`, `exam_desk_remarks` + `remark_source`, Hindi via Sarvam |
| Have | Term marks per subject with `grade` (CBSE 8-point) and a **free-text `remark` typed by the teacher** (`lib/exams.ts` `StudentSubjectMark`); NEP-2020 HPC co-scholastic ratings A/B/C per domain (`StudentCoScholasticEntry`); attendance module; discipline incidents; PTM feedback (strengths / areas / follow-up); `ReportCardSheet.tsx` renders it all |
| Missing | Any AI remark generation. No tone control. No "trend vs last term" input. No AI/human flag on `remark` |
| Build | `POST /api/ai/report-remark` (single) + `report-remarks-batch` (whole class). Prompt = marks + grade + previous-term delta + attendance % + co-scholastic ratings + discipline count + tone (`encouraging`/`balanced`/`firm`) + language. Output JSON `{ subjectRemark, overallRemark, hindiRemark? }`. Review grid: teacher sees generated remark inline in the mark-entry sheet, edits, accepts → writes `remark` + `remarkSource: "ai"\|"ai_edited"\|"manual"` |
| Data needed | Add `remarkSource` + `remarkGeneratedAt` to `StudentSubjectMark`. Everything else already exists |
| Model | **Gemini Flash** (3.6-flash). Bulk job (~40 students × 8 subjects × 3 terms), short outputs, cheap, tone-controllable, native Hindi. OpenAI as fallback via existing router |
| Effort | ~2 days |

### 1b. Competency-based question generation
| | |
|---|---|
| Have | Exam-paper AI (`lib/examPaperAi*.ts`) generating 9 question types (mcq / short / long / fill / true_false / match / numerical / diagram / primary_picture) with `answerKey`, `hardness`, per-subject "flavour", age-appropriate language, teacher edits before print |
| Status | ✅ shipped 2026-08-18 — `case_study` / `assertion_reason` / `competency` types; `competencyCode` / `unitId` / `bloomLevel` / `markingScheme[]` on every question (editor + teacher-copy print); paper `unitIds` picker fed from Teaching → Syllabus; `SyllabusUnit.competencyCodes` editable on the Syllabus tab (typed from the board's LO document — never generated); LLM on **pro** tier, prompt v2, LO tags restricted to the units given, deterministic top-up so the paper totals maxMarks |
| Was missing | Types CBSE now weights: **case-study / source-based, assertion-reasoning, competency (application/HOTS)**. No competency tag on a question. No marking scheme (only a one-line answer key). No syllabus-chapter linkage — questions are generated from class+subject only, not from `SyllabusUnit` chapters/topics |
| Build | Extend `ExamPaperQuestionType` with `case_study`, `assertion_reason`, `competency`; add `competencyCode`, `unitId`, `bloomLevel`, `markingScheme: string[]` to `ExamPaperQuestion`; feed selected `SyllabusUnit`s + their `learningOutcomes` text into the prompt |
| Data needed | `competencyCodes: string[]` per unit ✅. **Seed of CBSE LOs per class×subject still to do** — deliberately not generated by AI; import from the NCERT LO documents (public) or have teachers type them on the Syllabus tab |
| Model | **Gemini Pro-class** (`gemini-2.5-pro` / `gemini-3.1-pro-preview` — both available on the prod key) for paper generation; math/science needs the reasoning tier, Flash produces plausible-but-wrong numericals. Keep OpenAI (`gpt-4o` or o-series, not 4o-mini) as fallback for STEM. Set per-route model override |
| Effort | ~3–4 days incl. LO seed |

### 1c. Blueprint-driven papers
| | |
|---|---|
| Have | Sections, sets, max marks, hardness mix, print sheet, question `source` flag; **Question bank is a Tier-B placeholder** (module registered, `defaultEnabled: false`, no data) |
| Missing | Blueprint matrix (chapter × marks × difficulty × competency), fill-the-grid generation, real question bank with metadata tags |
| Build | `ExamBlueprint { rows: { unitId, questionType, marks, count, hardness, competencyCode }[] }` stored per class×subject×term; generator iterates rows, pulls from bank first (tagged match), asks LLM only for unfilled cells; marking scheme sheet printed alongside |
| Data needed | Question bank tables (`exam_question_bank` with the metadata above); blueprint table |
| Model | Gemini Pro (as 1b) |
| Effort | ~5 days |

**Prerequisite that unlocks all of §1 and §3:** per-question student results. Today only subject-level marks are stored — no item-level scores, so "Class 8-B is weak on application-based Geometry" is not derivable. Add `exam_item_scores (studentId, paperId, questionId, marksObtained)` and a fast entry grid / OMR-style import. Without this, "competency analytics" is a slide, not a feature.

---

## 2. Parent Communication Hub — mostly built, language is the gap

| Feature | Status | Notes |
|---|---|---|
| AI-drafted fee reminders / defaulter messages + call scripts | ✅ | `collections-draft` + payment-likelihood scoring (`lib/collectionsAi.ts`) |
| AI-drafted WA templates (Meta-compliant) | ✅ | `wa-template-draft`, EN + HI seeds |
| Attendance / performance / PTM invites | 🟡 | Templates + automation exist; drafts are template-based, not per-student personalised |
| **Per-family language preference** | ✅ (2026-08-18) | `Household.preferredLanguage` / `channelPreference` / `quietHoursStart|End` (Students → Family), `sis_households` columns + `sis_push_guarded` coalesced; helpers in `lib/householdPrefs.ts` (`householdLanguage`, `waTemplateLanguageFor`, `sarvamTargetFor`, `isInQuietHours`). "" = not asked, never defaulted silently |
| Regional languages beyond Hindi | 🟡 | en/hi/bho/mai/ur/bn selectable per family. Collections drafts render regional via Sarvam (`sarvamTargetFor`); WA *templates* still en/hi (Meta approval), regional collapses to Hindi template. Bhojpuri has no Sarvam target → Hindi |
| PTM per-student progress summary | ✅ (2026-08-18) | PTM → Feedback → "Meeting brief": `POST /api/ai/ptm-student-brief` — last 2 exam terms, attendance %, homework submitted/due, conduct log, earlier PTM notes → observations / concerns / suggestions in the family's language (regional via Sarvam); "Use as feedback starter" copies into the fields. `lib/ptmBriefAi.ts` + `lib/ptmBriefFacts.ts` |
| Admissions inquiry responder | ✅ | WhatsApp CRM bot (keyword flows + LLM fallback + RAG). **Grounding is thin** — KB only holds notices; fee structure / admission process / documents list aren't indexed |
| Parent chat thread summary | ✅ | `thread-summary` |
| Email channel | ❌ | Blocked on provider signup (§5.2 item 6 of the roadmap) |

Build:
1. ~~`Household.preferredLanguage` + `channelPreference` + quiet hours~~ **Done 2026-08-18.** Reads it: `collections-draft` (DefaultersPlaybook), fee-receipt WA template pick (`fees.ts`). Still to wire: automation sends (`isInQuietHours` gate), WA parent bot reply language, PTM brief (§2.2). Backfill: per-student form only — a bulk "ask every family" WA flow is a follow-up.
2. ~~`POST /api/ai/ptm-student-brief`~~ **Done 2026-08-18.** Absent sources are passed as "not available" and the prompt forbids commenting on them.
3. Extend `schoolKb` sources: fee structure (from `feeStructures`), admission process + document checklist (from admissions masters), holiday calendar, transport routes (1–2 days).

Model:
- English/Hindi drafts, summaries, RAG answers → **Gemini Flash**.
- Regional languages (Bhojpuri/Maithili/Bengali/etc.), Hinglish tone, and formal-register Hindi translation → **Sarvam** (`sarvam-translate` / Sarvam-M) — the one place it clearly beats both; INR billing, India-hosted.
- Voice: parent-facing IVR / voice notes in Hindi → **Sarvam Saarika (STT) + Bulbul (TTS)** over Google Speech; Google stays for staff EN dictation.
- Embeddings: currently OpenAI. Consolidating onto Gemini embeddings (`gemini-embedding-001`) is optional; requires re-embedding all `school_kb_chunks` — do it only when KB sources expand (step 3 above).

---

## 3. Academic Planning & Analytics — thinnest area

| Feature | Status | Notes |
|---|---|---|
| At-risk flagging | 🟡 | Exists for **fee defaulters** and **admission leads** only. No academic at-risk |
| Pedagogical suggestions | ❌ | Blocked on item-level scores (§1 prerequisite) |
| AI lesson plans | ✅ (2026-08-18) | `POST /api/ai/lesson-plan` + "Draft with AI" in `LessonPlansPanel` editor — ticked chapters/topics + their `learningOutcomes` → objectives / aids / period-by-period activities / assessment / homework, EN or HI; `LessonPlan.source` (`manual`/`ai`/`ai_edited`) + `aiModel` recorded on save. `lib/lessonPlanAi.ts` |
| CBSE Learning-Outcomes mapping | ❌ | free-text per unit; no codes |
| Syllabus pacing analytics (deterministic) | ✅ | `lib/teaching.ts` |

Build:
1. ~~`POST /api/ai/lesson-plan` — topic (unitIds) + class + periods → fills the existing `LessonPlan` fields, teacher edits in `LessonPlansPanel`~~ **Done 2026-08-18.** Follow-up when §1b lands: feed `competencyCodes` per unit into the prompt.
2. Academic at-risk: deterministic rules (grade drop ≥1 band vs last term, attendance < 75%, ≥N discipline incidents, homework completion < X) → list; LLM only writes the per-student "what to do" note. Never let the model decide who is at risk (½ day rules + ½ day narrative).
3. Class-level pedagogy suggestions + remedial worksheet — after item-level scores exist.

Model: **Gemini Flash** for lesson plans and narratives; Gemini Pro for remedial worksheet generation (it's question generation). Detection is code, not a model.

---

## 4. Administrative Document Automation — largely done

| Feature | Status | Notes |
|---|---|---|
| Circulars / notices / letters / govt submissions, EN/HI/both | ✅ | `school-document` with 10 presets (formal letter, govt submission, permission, leave approval, bonafide, fee concession, transport NOC, event permission, staff appointment, general circular); PDF letterhead + Devanagari |
| Certificates, TCs, staff agreements | ✅ | AI-drafted, `aiDrafted` flag, human edits |
| Meeting minutes from notes/transcript | ❌ | No meeting entity. Build `POST /api/ai/meeting-minutes` (raw notes or audio → structured minutes + action items → tasks/duties). Existing Google Speech for EN audio |
| Compliance narrative (CCE records, teacher-training logs, infra audit) | 🟡 | `lib/udiseCompliance.ts` + `/mpd` (mandatory public disclosure) exist; no AI narrative sections, no teacher-training log |
| Translation of existing docs | 🟡 | only via regenerating in `hi` |

Model: **Gemini Flash** for drafts and minutes (long context handles a 2-hour transcript); **Sarvam** for formal Hindi translation of finished documents; Hindi meeting audio → Sarvam Saarika.

---

## 5. Admission Management — CRM side done, document side not

| Feature | Status | Notes |
|---|---|---|
| Lead scoring + AI next-best-action + follow-up drafts | ✅ | `lib/admissionsAi.ts`, `lead-next-action` |
| WhatsApp inquiry bot, partial-lead capture, campaigns | ✅ | |
| Inbound documents from parents (Aadhaar, birth cert) → OCR | 🟡 | `waInboundMedia.server.ts` + Vision extracts text; **no structured field extraction, no completeness check** |
| Application form (PDF/image) → structured record | ❌ | |
| Offer letter / fee structure / welcome packet | 🟡 | Add 3 presets to `SCHOOL_DOCUMENT_PRESETS` (`admission_offer`, `fee_structure_letter`, `welcome_packet`) fed with the lead + fee plan — ½ day |

Build: `POST /api/ai/application-extract` — image/PDF → `{ studentName, dob, aadhaarLast4, parentName, mobile, previousSchool, class, missing: [] }` → pre-fills the admission form, flags incomplete.

Model: **Gemini Flash multimodal** — one call does OCR + structuring (cheaper than Vision→LLM two-step, handles Devanagari forms well). Keep Vision for the existing pipelines. Sarvam's document/vision APIs are an option for heavily handwritten Hindi forms; not needed for the first cut.

---

## 6. Architecture foundations — status and required work

| Foundation | Status | Required |
|---|---|---|
| Centralised server-side AI layer, no frontend API calls | ✅ | — |
| Failover between providers | ✅ | Per-call `meta.tier: "flash"\|"pro"` (2026-08-18) — `geminiModel(tier)` / `openAiModel(tier)`, pro models via `GEMINI_PRO_MODEL` (default `gemini-2.5-pro`) / `OPENAI_PRO_MODEL` (default `gpt-4o`). No route requests pro yet; §1b will |
| Human-in-the-loop | 🟡 | All staff-facing generators land in an editor before save/print ✅. **Exception: WA bot LLM fallback auto-replies to parents** — add a confidence gate + "escalate to staff" default for anything not grounded by RAG |
| Language preference per family | ✅ | `Household.preferredLanguage` (see §2) |
| AI audit trail | ✅ (2026-08-18) | `ai_generations` (migration `20260818150000`) written by the router for **every** attempt on every route: route, prompt_version, tier, engine/model, status/error, input+output sha256 (no text), tokens, latency, requester (session email or `system`). `POST /api/ai/generations/outcome` closes the loop — Remarks tab and Lesson plans editor report accepted / edited / rejected + target record. Other generators record attempts but don't yet report outcomes |
| Rate limiting / quotas | ❌ | Per-user + per-tenant daily token budget in the router (reuse `mapsRateLimit.ts` pattern) |
| Caching | ❌ | Hash(prompt) → response for deterministic drafts (certificates, lesson plans); skip for personalised outputs |
| Prompt versioning | 🟡 | Every router call carries `meta.promptVersion` (all "v1" today), recorded in `ai_generations`; bump it when a route's prompt changes. Prompts themselves still inline in `aiLlm.server.ts` / `lib/*Ai.ts` — moving them to `lib/prompts/` is cosmetic now that the version is tracked |
| Data quality for §1/§3 | ❌ | Item-level scores; competency codes on syllabus units and questions |
| Sarvam adapter | 🟡 | `lib/sarvam.server.ts` translate (en/hi/bn/ur/mai/ta/te/mr/gu/kn/ml/pa/od) ✅; STT/TTS ❌; `SARVAM_API_KEY` in Secret Manager **pending** |

---

## 7. Provider fit — summary

| Use case | Primary | Fallback / note |
|---|---|---|
| Report-card remarks (bulk, EN/HI, tone) | Gemini Flash | OpenAI 4o-mini |
| Competency questions, blueprint fill, marking schemes, remedial worksheets | Gemini Pro | OpenAI 4o / o-series for STEM correctness |
| Parent messages, PTM briefs, RAG answers (EN/HI) | Gemini Flash | OpenAI |
| Regional languages, formal Hindi translation, Hinglish | **Sarvam** | Gemini |
| Parent-facing voice (Hindi IVR, voice notes) | **Sarvam** Saarika/Bulbul | Google Speech (already wired) |
| Lesson plans, at-risk narratives, digests, minutes | Gemini Flash | OpenAI |
| Application / document extraction | Gemini Flash multimodal | Google Vision (existing) |
| Embeddings | OpenAI `text-embedding-3-small` (as-is) | Gemini embeddings when KB expands |
| Anything auto-sent to parents without review | none — gate it | — |

Why not Sarvam as a general engine: weaker on multi-step reasoning and structured JSON reliability than Gemini Pro/OpenAI, no vision parity, smaller ecosystem — but the best Indic language/speech layer, INR billing, India data residency. Use it as a **language layer**, not a reasoning layer.

Why Gemini as default: cheapest at this volume, same GCP project/billing/IAM as Cloud Run + Firebase, strong Hindi, best price/perf on multimodal, `asia-south1` residency available. OpenAI stays as automatic fallback and for embeddings — removing it buys nothing.

---

## 8. Suggested build order (impact ÷ effort)

1. ~~**Report-card remark generator** (§1a)~~ — shipped 2026-08-18 (`914b421`).
2. ~~**AI lesson plans** (§3.1)~~ — shipped 2026-08-18.
3. ~~**`ai_generations` audit table + prompt versioning + per-route model tier** (§6)~~ — shipped 2026-08-18.
4. ~~**Household language preference + Sarvam translate adapter** (§2.1)~~ — shipped 2026-08-18 (quiet-hours gate on automation sends and bot reply language still to wire).
5. ~~**PTM per-student brief** (§2.2)~~ — shipped 2026-08-18.
6. ~~**Competency question types + LO codes on syllabus** (§1b)~~ — shipped 2026-08-18 (LO seed import outstanding).
7. **Item-level scores** → academic at-risk → pedagogy suggestions (§1 prereq, §3.2–3.3) — 5+ days.
8. **Blueprint + question bank** (§1c) — 5 days.
9. Application extraction, meeting minutes, compliance narratives, admission presets — ½–1 day each, slot anywhere.
