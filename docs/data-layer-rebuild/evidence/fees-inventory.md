# Fees desk — server readers and writers (step 5.1a)

Measured 15 Oct 2026 on origin/main `fa637423` (not deployed; production runs an older revision —
every code path below also exists on the live revision unless a line says otherwise) and the
production database `ymamhlcrjsuilzdonkzl` (read-only `SELECT` counts and Supabase edge-log
counts). No production write was made. Nothing in this step changes behaviour.

**What could not be measured.** `gcloud` on this laptop needs an interactive re-login
(`Reauthentication failed. cannot prompt during non-interactive execution`), so **Cloud Run logs
were not read**. Production frequency below comes from the Supabase edge logs instead (7 × 24 h
windows, 08 Oct 18:30 UTC → 15 Oct): they count the PostgREST calls each code path makes, which
identifies the *kind* of write, but not *which route* sent it (every write leaves from Cloud Run).
The per-route split needs the Cloud Run query at the end of this file, run by someone logged in.

---

## 1. The tables (production, 15 Oct 2026)

| Table | Rows | Last `updated_at` | Written by (today) |
|---|---:|---|---|
| `fee_desk_vouchers` | 698 (83 voided) | 14 Oct 05:08:13 — **all 698** carry that push's stamp | `replace_fee_desk_voucher_lines` (header upsert, **all columns LWW**); `sisSeparate.server.ts:163` (`household_id`); `sis_merge_students` (no header columns) |
| `fee_desk_voucher_lines` | 2,897 | (no column) | `replace_fee_desk_voucher_lines` (insert only where the receipt has none); `repair_fee_receipt_allocation`; `sis_merge_students` (UPDATE `student_id` — **refused since 7 Sep by the append-only trigger**, see risk R9) |
| `fee_desk_voucher_tenders` | 728 | (no column) | `replace_fee_desk_voucher_lines` (insert only where the receipt has none) |
| `fee_desk_open_dues` | 929 (all `balance > 0`; 190 students, 1 year) | 13 Oct 08:30 | `fee_desk_replace_open_dues` (whole-year replace) from `rebuildFeeOpenDuesCache`; `sis_merge_students` (delete) |
| `fee_desk_cheques` | 0 | — | `pushFeeDeskAncillaryToDb` (upsert, status-monotonic since 10 Oct) |
| `fee_desk_manual_books` | 2 | 14 Oct 05:08:14 | `pushFeeDeskAncillaryToDb` (upsert, **plain LWW**) |
| `fee_desk_day_closes` | 0 | — | `pushFeeDeskAncillaryToDb` (upsert, action-time-monotonic; named deletes) |
| `fee_desk_charge_vouchers` | 4 | 14 Oct 05:08:14 | `pushFeeDeskAncillaryToDb` (upsert; voided stays voided) |
| `fee_desk_charge_voucher_lines` | 4 | (no column) | `replace_child_rows` from `pushFeeDeskAncillaryToDb` |
| `fee_desk_installment_plans` | 0 | — | `pushFeeDeskAncillaryToDb` (upsert; cancelled is final) |
| `fee_desk_plan_allocations` | 0 | (no column) | `pushFeeDeskAncillaryToDb` (insert-ignore; delete by voided receipt ids) |
| `fee_desk_carried_forward` | 76 | 14 Oct 05:08:14 — **all 76** | `pushFeeDeskAncillaryToDb` (upsert; voided stays voided) |
| `fee_desk_sync_meta` | 1 | 14 Oct 05:08:16 | `pushFeeVouchersToDb`, `pushFeeDeskAncillaryToDb`, `fee_desk_replace_open_dues` |
| `fee_pdc_cheques` / `fee_bulk_payments` | 0 / 0 | — | `feePdc.server.ts` / `feeBulkPayments.server.ts` (row writes; not part of the desk copy) |

Also present: four `*_pre_identity_split_20260812` backup tables (vouchers lines, open dues,
plans, carried forward, charge vouchers) — not read by any code.

Triggers on the desk (production `pg_trigger`): `fee_desk_vouchers_ledger_autopost` and
`fee_desk_voucher_tenders_ledger_autopost` (AFTER INSERT **OR UPDATE**, per row →
`fee_ledger_post_collection` or `fee_ledger_reverse_voided`, exceptions swallowed);
`fee_desk_voucher_lines_append_only` and `fee_desk_voucher_tenders_append_only` (BEFORE UPDATE OR
DELETE → refuse unless `bhb.receipt_edit = 'repair'`). Every whole-desk push therefore UPDATEs all
698 headers and fires the ledger trigger 698 times.

`replace_fee_desk_voucher_lines` in production matches `20260907130000_fee_receipt_lines_append_only.sql`
(its body contains `on conflict (id) do update set <every column>`; checked by `pg_get_functiondef`).

### Who maintains `fee_desk_open_dues`

Only `rebuildFeeOpenDuesCache(ay)` (`lib/feesDeskAncillary.server.ts:545`), which:

1. calls `ensureSchoolMirrorHydrated()` (45 s TTL, probe-gated) and `ensureFeeDuesInputsHydrated({force:true})`;
2. computes `computeStudentDues` for **every active student of the year from the server's
   in-memory copy** (`loadSis()`, `loadMasters()`, `loadFees()`), not from the request body;
3. sends the full year to `fee_desk_replace_open_dues` (deletes rows absent from the payload,
   upserts changed rows, updates `fee_desk_sync_meta.open_dues_count`).

It is called from `pushFeeDeskToDb` (`lib/feesNormalized.server.ts:798-799`) on **every** whole-desk
push (browser POST and every server `pushFeesRemoteServer`), and from
`POST /api/fees/rebuild-open-dues` (`app/api/fees/rebuild-open-dues/route.ts:84`; staff with
fees:edit or `x-cron-secret`; no Cloud Scheduler job in `scripts/setup-cloud-scheduler.sh`, no code
caller — manual only, as far as the repo shows). `sis_merge_students` deletes the dropped ids' rows.

**Nothing else moves it.** A Masters fee-structure or concession change, a transport rider/fare
change, a posted fee adjustment, a student admitted/left — none of these rebuilds the cache; it
catches up on the next fee push.

**Proven stale today.** Receipt `RCV-00698` (collected 14 Oct 05:08:06 UTC, one student) was pushed
at 05:08:13 and the rebuild ran (sync meta 05:08:16; one `fee_desk_replace_open_dues` call in that
day's edge log). The student's three dues it paid in full are **still open in the cache** —
₹1,800 (`acad:…:fsl_dhqb3829` ₹1,450, `transport:…:2026-10` ₹300, `transport:…:2026-09` ₹50), rows
last written 3 Oct / 16 Sep. That is what the parent app, `/pay/due`, the reminders and the
principal cockpit quote for this family. It is consistent with step 2 above computing from an
instance copy that did not yet hold the receipt (the POST does not put its body into the server
copy, and `ensureSchoolMirrorHydrated` skips the re-read for 45 s after the last one); the
instance's memory at 05:08 cannot be observed after the fact, so the cause is **traced in code,
not proven**. The director can clear it with `POST /api/fees/rebuild-open-dues` from a staff
session (it rebuilds from a copy that now contains the receipt) — not done here (production write).

---

## 2. Server-side writers (the ones 5.1b must convert first)

"Whole desk" = the write sends the instance's entire fee copy (`loadFees()` = `getSchoolMirrorSync().fees`)
through `pushFeesRemoteServer` → `pushFeeDeskToDb` → `replace_fee_desk_voucher_lines` (all 698
headers, LWW) + `pushFeeDeskAncillaryToDb` (all ancillary rows) + `rebuildFeeOpenDuesCache` (whole
year). "Overwrite newer?" answers: can this write put an older value over a newer row? (the 1 Sep /
6 Sep class).

| # | Entry point (trigger) | Fee mutation (file:line) | Hydrate before mutate | Write (file:line) | Scope | Tables | Overwrite newer? |
|---|---|---|---|---|---|---|---|
| W1 | `POST /api/payments/cashfree/webhook` → `settlePaymentLinkWithWhatsApp` (`route.ts:511`) | `applyPaymentLink` → `collectPayment` (`lib/payments.ts:562`, `lib/fees.ts:3354`) | `ensureSchoolMirrorHydrated` (`paymentSettlement.server.ts:47`), `ensureFeeDuesInputsHydrated({force})` (:77-80) | `pushFeesRemoteServer(loadFees())` `paymentSettlement.server.ts:152` | **whole desk** | all 13 + open dues | **Yes.** Headers LWW incl. `voided_at` and `whatsapp_sent_at` (a void done in the last ≤ 45 s, or on another instance before this one re-hydrated, is undone and the ledger re-posts it); ancillary non-status fields LWW; open dues rebuilt from this copy |
| W2 | `POST /api/payments/razorpay/webhook` (`route.ts:182`) | same as W1 | `ensureSchoolMirrorHydrated` (:126) + W1's | W1 | whole desk | as W1 | as W1 |
| W3 | `POST /api/payments/parent-pay` (`route.ts:89`) | same as W1 | :69 + W1's | W1 | whole desk | as W1 | as W1 |
| W4 | `settleCashfreeCheckout` (`lib/cashfreeCheckouts.server.ts:377`) — from the Cashfree webhook (`route.ts:323`) and the return page `app/pay/cf/[orderId]/page.tsx:64` (a parent's browser **GET** of a page) | same as W1 | :351 + W1's | W1 | whole desk | as W1 | as W1 |
| W5 | fee auto-pay: `applyChargeOutcome` (`lib/feeAutopay.server.ts:877`) — from the Cashfree webhook (`route.ts:265`), `POST /api/fees/autopay/tick` (Scheduler `bhb-fee-autopay-tick` 10:15 daily), `/api/fees/autopay`, `/api/v1/autopay` | same as W1, once per link | `familyDues` hydrates mirror + `ensureFeesHydratedServer` (:591-592) | W1, once **per link** in the loop | whole desk × links | as W1 | as W1 |
| W6 | `POST /api/v1/staff/fees/collect` (staff app counter) | `collectPayment` (`route.ts:198`) | `loadFeeContext()` (`lib/api/v1/staffFees.ts:26-29`: mirror, sis, payments, `ensureFeesHydratedServer`) + `assertFeeBookComplete` (count only) | `pushFeesRemoteServer(loadFees())` `route.ts:216` | whole desk | as W1 | as W1 (hydrate is fresh from the DB on every call, so the window is the request's own duration, ~1–3 s) |
| W7 | Fees → Bulk & PDC: `POST /api/fees/tools/bulk-payment` → `feeBulkPayments.server.ts:151`; `POST /api/fees/tools/pdc` deposit → `feePdc.server.ts:335` | `postReceiptsTogether` → `collectPayment` ×N (`lib/feeTools.server.ts:235`) | `loadFeeToolsContext` (`feeTools.server.ts:48-55`: as W6 + forced dues inputs) | `feeTools.server.ts:274`, retry :302; on failure `dropAndRehydrate` (:342-350) | whole desk (×2 on retry) | as W1 + `fee_bulk_payments` / `fee_pdc_cheques` rows | as W6 |
| W8 | Cashfree refund outcome: webhook (`route.ts:291`), `POST /api/fees/refund` poll (`route.ts:48` → `pollRefund` `cashfreeRefunds.server.ts:474`), and synchronously on request (`:317`) | `voidVoucher` (`cashfreeRefunds.server.ts:406`) | `ensureSchoolMirrorHydrated` only (:376-377) — **45 s-old copy** | `pushFeesRemoteServer(loadFees())` `:429` | whole desk | as W1 (+ cheques→bounced, plan allocations deleted, plans reopened by `voidVoucher`) | **Yes** — as W1, and the copy may be 45 s old |
| W9 | Cashgram fee refund REDEEMED: `POST /api/payouts/webhook` (`:66,:91` → `onCashgramWebhook`), `refreshCashgramRefund` from `/api/fees/cashgram-refund`, `/api/payouts/cashgram`, `payoutRequests.server.ts:678` | `voidVoucher` (`cashgramRefunds.server.ts:639`) | `loadFeeWorld` → `ensureSchoolMirrorHydrated` (:214-215) — 45 s-old copy | `pushFeesRemoteServer(loadFees())` `:646` | whole desk | as W8 | as W8 |
| W10 | Cashfree **registration** payment: webhook `settleRegistrationPayment` (`route.ts:164`) | `captureRegistrationPayment` → `applyRegistrationLedgerSync` (`lib/admissions.ts:4119`) → `syncLeadRegistrationToLedger` → `collectPayment` (`lib/registrationFeeLedger.ts:340`) when the lead has an SIS student | none for fees (`loadAdmissions()` only) | **none** — `saveFees` on the server only sets the mirror slice (`lib/fees.ts:1544-1548`). The R-receipt lives in one instance's memory and is written only if a later W1–W9 on the same instance carries it | (lost) | — | Latent: production has **0** Cashfree-mode registration payments (29 paid, all cash/UPI at the counter, browser path), so it has not fired. Same defect class as the 26 Sep AADVIK SINGH loss |
| W11 | `POST /api/school-data/fees-vouchers` (browser debounce, see §4) | — (body is the browser's copy) | `fetchFeeDeskFromDb()` for the audit diff only (`route.ts:129`) | `pushFeeDeskToDb(body)` `route.ts:132` | whole desk from the browser | all 13 + open dues (rebuilt from the **server's** copy, not the body) | **Yes** — headers LWW (any tab older than a void un-voids it), ancillary non-status fields LWW, open dues from a possibly older instance copy (proven case above) |
| W12 | `POST /api/fees/rebuild-open-dues` (manual) | — | mirror + forced dues inputs | `rebuildFeeOpenDuesCache` `route.ts:84` | whole year of `fee_desk_open_dues` | open dues, sync meta | Yes — from the instance copy (≤ 45 s old) |
| W13 | `POST /api/school-data/ensure-desk` → `ensureDeskCutoverServer` (`lib/ensureDeskCutover.server.ts:224-232`) | — | `fetchFeeDeskFromDb` | `pushFeeDeskToDb(fees_state blob)` only when the desk has **0** vouchers | whole desk from the legacy blob | all | Only on an empty desk (guarded by a successful read); dead in practice (698 vouchers) |
| W14 | `saveOpsFees` (`lib/deskOpsLoad.server.ts:66-68`) | caller-supplied | `loadOpsFees` (fresh DB read) | `pushFeeDeskToDb(state)` | whole desk | all | **No caller** in `apps/web/src` or `scripts/` — dead code |
| W15 | `POST /api/fees/repair-receipt` (`route.ts:106`) | — | reads one header (:56) | `repair_fee_receipt_allocation` RPC | **row** (one receipt's lines, total enforced) | lines | No (refuses a breakdown ≠ total; records who) — but does **not** rebuild open dues or bump sync meta |
| W16 | `separateStudentFromFamily` (`lib/sisSeparate.server.ts:160-165`) | — | direct SQL | `UPDATE fee_desk_vouchers SET household_id, updated_at` | row | vouchers | No — and `pushFeeVouchersToDb` keeps the server's `household_id` (`feesNormalized.server.ts:437-445`). Does not bump `fee_desk_sync_meta` |
| W17 | `sis_merge_students` RPC (`sisNormalized.server.ts:1497`) | — | — | UPDATE lines/charge vouchers/carried forward `student_id`, DELETE open dues | rows | 4 tables | No — but the lines UPDATE is refused by the append-only trigger (R9) |
| W18 | `sendSisFeeReceiptOnWhatsApp` (`lib/waSisBotServer.ts:1596-1618`) | `markWhatsAppReceiptSent` (mirror only) | mirror | none | — | — | **No caller** — dead code |

Server **in-memory-only** fee edits (no push of their own): `forgetInMemory` in `feeTools.server.ts:106-111`
(removes unconfirmed receipts from the instance copy — intended), W10, W18.

### Production frequency (Supabase edge logs, IST days ending 18:30 UTC)

| Window (UTC) | `rpc/replace_fee_desk_voucher_lines` = whole-desk pushes | `rpc/fee_desk_replace_open_dues` | `GET fee_desk_day_closes` ≈ whole-desk reads (`fetchFeeDeskAncillaryFromDb`) | Receipts made that IST day |
|---|---:|---:|---:|---:|
| 08 → 09 Oct | 6 | 6 | 573 | 3 (8 Oct) |
| 09 → 10 Oct | 4 | 4 | 403 | 6 |
| 10 → 11 Oct | 0 | 0 | 228 | 3 |
| 11 → 12 Oct | 8 | 8 | 522 | 0 (Sun) |
| 12 → 13 Oct | 6 | 6 | 207 | 7 |
| 13 → 14 Oct | 1 | 1 | 171 | 8 / 1 |
| 14 → 15 Oct | 0 | 0 | 164 | 0 |
| **7 days** | **25** | **25** | **2,268** | **28** (27 `counter`, 1 `payment_link`) |

Gateway events in the same 7 days (`payment_desk_gateway_events`): 1 `fee_link.settled`, 1
`fee_link.already_paid`; `cashfree_refunds`, `cashgram_refunds` and `fee_autopay_charges` hold no rows.
So of the 25 pushes, **≥ 1** came from a server writer (the pay-link settlement, W1/W3/W4); the rest
are browser POSTs (W11) or the staff app (W6) — the split needs Cloud Run (query in §7).
Since `pg_stat_statements` was reset (12 Aug): 199 `replace_fee_desk_voucher_lines`, 862
`fee_desk_replace_open_dues`, 1,358 whole ancillary upserts.

The 2,268 whole-desk reads in 7 days (~324/day, each paging all 13 tables) are §3's readers:
`ensureFeesHydratedServer` has **no TTL, no probe and no in-flight dedupe** (`lib/feesPersistence.server.ts:40-91`).

---

## 3. Server-side readers of the fee copy

All read **the whole desk** (the instance copy) and filter in Node. None writes.

| Reader (file:line) | How it gets the copy | Triggered by |
|---|---|---|
| `loadFeeContext` `lib/api/v1/staffFees.ts:26-29` | mirror + `ensureFeesHydratedServer` (full DB read every call) | staff app `GET /api/v1/staff/fees/{search,dues,collections,defaulters,followup}`, `collect` (W6), `POST /api/fees/receipt-wa` (`route.ts:96`), `GET /api/fees/tools/lookup` (`:33`) |
| `openDuesForPayLink` `lib/feePayLink.server.ts:61-71` | mirror + `ensureFeesHydratedServer` | WhatsApp staff command "pay link" (`erpCommands.server.ts`) |
| `startDirectFeeCheckout` / dues `lib/duePayCheckout.server.ts:70,121` | mirror (≤ 45 s) | parent opens `/pay/due/[token]` |
| `resolveChosenDues` `lib/parentFeeCheckout.server.ts:60-66` | mirror | `POST /api/payments/parent-checkout`, `…/quote` (parent app) |
| `familyDues` `lib/feeAutopay.server.ts:591-604` | mirror + `ensureFeesHydratedServer` + forced dues inputs | auto-pay tick / mandate charge |
| `liveFeeFamilies` `lib/automationAudience.server.ts:304-305` | `ensureFeesHydratedServer` + dues inputs | `bhb-wa-automation-tick` (*/30 8-19 Mon–Sat), fee reminders (`feeReminder.server.ts:215`), approval cards (`feeFamilyLive.server.ts`) |
| `waAudienceResolve.server.ts:215` | `ensureFeesHydratedServer` | `POST /api/wa/send`, `/api/comms/parents-on-app/invite`, `waAudienceSend` (defaulter audiences) |
| `dailyBrief.server.ts:855` (+ direct SQL :86, :108) | `ensureFeesHydratedServer` | `bhb-daily-brief` 18:00, `/api/reports/daily-brief[/send]`, `/api/v1/attendance/month`, leave command |
| `erpAsk.server.ts:89-93` (+ open dues SQL :77) | `ensureFeesHydratedServer` | WhatsApp/AI "ask the ERP" |
| `erpCommands.server.ts:1874, 3496, 3661, 3769, 3815, 5045` | `ensureFeesHydratedServer` | WhatsApp staff commands (`waUnifiedBotServer`), `/api/v1/commands`, commands digest tick |
| `erpReports.server.ts:57, 75-78` | `ensureFeesHydratedServer` | PDF reports on command |
| `udiseDocIntake.server.ts:371-375` | `ensureFeesHydratedServer` | `POST /api/wa/webhook` (UDISE document intake) |
| `cashgramRefunds.server.ts:214-219` (`loadFeeWorld`) | mirror | refundable amount, prepare/approve refund |
| `principalSnapshot.server.ts:78, 142` | mirror (+ open dues summary :131-133) | `/api/v1/principal/snapshot`, leadership digest, owner anomalies |
| `waLeadershipReports.server.ts:68, 154` | mirror (caller hydrates) | staff WA bot leadership reports, AI context |
| `waSisBotServer.ts:282, 739, 806` | mirror (`:1058`) | parent WhatsApp bot (fee balance answers) |
| `app/api/v1/parent/summary/route.ts:33, 117` | mirror (+ open dues cache :100) | parent app home |
| `app/api/v1/fees/ledger/[studentId]/route.ts:43, 70` | mirror (+ open dues cache :86) | parent/staff app fee ledger |
| `app/api/v1/principal/lists/route.ts:42, 59` | mirror | principal app lists |
| `app/api/ai/collections-weekly-note/route.ts:46, 52` (+ open dues SQL :63) | mirror | Scheduler `bhb-collections-weekly-note` Mon 08:15 |
| `app/api/ai/concession-case-file/route.ts:50, 56` | mirror | AI concession case file |
| `rebuildFeeOpenDuesCache` `feesDeskAncillary.server.ts:552-567` | mirror + forced dues inputs | W11, W12 and every server push |
| `receiptArchive.server.ts:65` | `fetchFeeVouchersFromDb` (fresh, whole) | Scheduler `bhb-drive-archive-receipts` 15:45 |
| `GET /api/school-data/fees-vouchers` `route.ts:58-73` | `fetchFeeDeskFromDb`, probe-cached | every browser fee hydrate |

Row-level SQL readers (no copy; fine as they are, listed so 5.1b knows what reads the tables):
`app/api/fees/tender-ref-uses`, `app/api/fees/repair-receipt:56`, `lib/feeTools.server.ts:113-170`,
`lib/feePdc.server.ts:112`, `lib/feeIntegrityAlert.server.ts:91-220` (Scheduler hourly),
`lib/defaulterHold.server.ts:166`, `lib/parentResults.server.ts:102`, `lib/ledger/project.server.ts:251-296`,
`lib/ledger/controls.server.ts:237-254`, `lib/api/v1/staffFees.ts:49`, `lib/sisSeparate.server.ts:137-163`,
`lib/feeStoreDuesKpi.ts:71,119`, `fetchHouseholdVouchersFromDb`, the BigQuery nightly sync
(`bigQuerySyncCatalog.ts:19-34`). `ensureSchoolMirrorHydrated` itself re-reads the fee desk only when
the probe over `fee_desk_vouchers`/`fee_desk_voucher_lines` changes — **ancillary tables and
`fee_desk_open_dues` are not in that probe** (`schoolMirrorRemote.server.ts:31-50`), so an instance's
cheques/day closes/charges/plans/carried-forward can stay old for as long as no receipt changes.

Library code that calls `loadFees()` and is also reachable from server code was **not traced
call-by-call**: `accountsReportCatalog`, `certificates`, `feeAgreementPdf`, `feeDashboard`,
`feeFinance`, `feeReportCatalog`, `feeTakeAgreementPdf`, `holds`, `moduleDashboards`, `parentPortal`,
`playbook`, `referralRewards`, `reportDataGuard`, `transportReportCatalog`, and the ~20 fees.ts helpers
that read the copy internally (`searchFeeStudents`, `listCheques`, `vouchersForCollectionDate`, …).
They are readers only (no push), so they do not block 5.1b; 5.1d will meet them with their screens.

Not fee-desk writers (checked, ruled out): transport fees (computed from `transport_desk_slices`,
never stored in `fee_desk_*`), fee adjustments (`module_local_state` `fee_adjustments`), defaulter
policy/holds (own tables; read open dues), store dues at Fee Take (`inv_*`), receipt auto-WhatsApp
(`wa_receipt_sends`), Drive archive (reads), UPI-proof (`upiProofs.server.ts` is outgoing payouts),
Cashfree settlement sweep (`payment_desk_*`, ledger), cashgram/payout paths other than W9.

---

## 4. Browser-side fee writers (for 5.1d)

Every browser fee edit goes `saveFees(state)` → `persistFeesClient` → `scheduleFeesSync`
(`lib/feesPersistence.ts:40-48`) → `scheduleFeesDeskSync` (`lib/feesNormalizedClient.ts:70-82`,
debounced) → `pushFeesDeskApi` (`:84-128`) → **`POST /api/school-data/fees-vouchers`** with the whole
copy, `rebuildOpenDues: true` and named day-close deletes (W11). The hydrate path no longer pushes
while `FEES_READ_FROM_DB` is on (`feesPersistence.ts:104-106`; the flag defaults to on).

| Screen / file:line | Mutation |
|---|---|
| `components/fees/FeeTakeWorkspace.tsx:1723` | `collectPayment` (counter receipt) |
| `FeeTakeWorkspace.tsx:1922` | `voidVoucher` |
| `FeeTakeWorkspace.tsx:1426` | `transferLastSessionDues` (carried forward) |
| `FeeTakeWorkspace.tsx:576` → `lib/feeCollectionWipe.ts:48` | `wipeFeeCollections` (memory only + mirror sync) |
| `components/fees/ManualBookPanel.tsx:389` | `collectPayment` (manual book leaf) |
| `components/fees/PayLinksPanel.tsx:112` | `applyPaymentLink` → `collectPayment` (mark link paid at the desk) |
| `components/fees/ChequesPanel.tsx:79, 103, 121` | `depositCheque`, `clearCheque`, `bounceCheque` |
| `components/fees/DayClosePanel.tsx:164, 179, 194, 208` | day close draft / submit / approve / reject |
| `components/fees/ChargeVouchersPanel.tsx:187, 478` | `createChargeVoucher`, `voidChargeVoucher` |
| `components/fees/InstallmentPlanDialog.tsx:112, 340` | `createInstallmentPlan`, `cancelInstallmentPlan` |
| `components/fees/ManualPreviousDuePanel.tsx:118, 136` | `saveFees` (carried forward add / void) |
| `components/fees/BulkPreviousDueByClassPanel.tsx:142` | `saveFees` (bulk previous dues) |
| `components/fees/PreviousDuesImportPanel.tsx:56` | `saveFees` (import) |
| `components/fees/PaymentReportImportPanel.tsx:85` | `saveFees` (gateway report import) |
| `components/admissions/AdmissionRegistrationPanel.tsx:433, 562` | `takeRegistrationPayment` / `captureRegistrationPayment` → R-receipt via `collectPayment` |
| `components/admissions/PublicFamilyRegisterForm.tsx:366`, `app/registration/pay/page.tsx:43` | `captureRegistrationPayment` |
| `components/field/StaffRegistrationCollectApp.tsx:213, 263` | `takeRegistrationPayment` / `captureRegistrationPayment` |
| `lib/fees.ts:4200, 4237, 4288` | `markWhatsAppReceiptSent` after a receipt WhatsApp |

---

## 5. Proposed contract for 5.1b

Columns are the production columns above. All functions `security definer`, `set search_path = public`,
granted to `service_role` only; each bumps `fee_desk_sync_meta` (`voucher_count` recounted,
`updated_at = now()`) in the same transaction so `erp_versions` moves (R3).

### 5.1 `fee_voucher_write(p_tenant uuid, p_header jsonb, p_lines jsonb, p_tenders jsonb, p_base_updated_at timestamptz, p_cheques jsonb default '[]', p_plan_allocations jsonb default '[]', p_open_dues jsonb default null, p_actor text default '') returns jsonb`

- `p_header` → `fee_desk_vouchers` (`id, household_id, academic_year_code, receipt_no, school_receipt_no,
  source, manual_book_series, manual_book_leaf, collection_date, transaction_date, transaction_id,
  collected_at, cashier_name, total_paise, note, voucher_json`). `voided_at`, `whatsapp_sent_at` and
  `updated_at` are **not** accepted here (see 5.2/5.3; `updated_at = now()` is set by the function).
- `p_lines` → `fee_desk_voucher_lines (id = voucher_id||':'||due_key, student_id, due_key, kind, label, amount_paise > 0, line_json)`.
- `p_tenders` → `fee_desk_voucher_tenders (id, tender_index, mode, amount_paise > 0, ref, instrument_date, bank_name, realisation, tender_json)`.
- `p_cheques` → `fee_desk_cheques` rows for cheque tenders (`status = 'received'`), `p_plan_allocations`
  → `fee_desk_plan_allocations` — the two side rows `collectPayment` makes today.
- **Create only.** `p_base_updated_at` must be null and the id must not exist; an existing id is
  `{ok:false, reason:'exists'}`. Idempotent replay: if `transaction_id <> ''` and a non-voided receipt
  with that `transaction_id` exists, return `{ok:true, duplicate:true, id, receipt_no}` and write
  nothing (what `postReceiptsTogether` and the webhook replay rely on).
- Refuses unless `sum(lines) = sum(tenders) = total_paise` and every line's `student_id` belongs to
  `household_id` (or the household is null for R-series).
- **Receipt number allocated inside the function** under `pg_advisory_xact_lock(hashtext('fee_receipt_no:'||tenant))`
  from the stored book (the `RECEIPT` number series in `masters_desk_settings` when set, else
  `F/<ay>/####` / `R/<ay>/####`), returned to the caller. Today `nextReceiptNo` (`lib/fees.ts:3265`)
  numbers from the instance copy, and only the unique index stops two instances minting one number.
- **Open dues for this receipt's students, same transaction:** `p_open_dues` = the full recomputed
  open-due rows for each student on the receipt (computed by the caller with `computeStudentDues`
  over inputs read fresh by SQL — masters, transport, adjustments, this student's receipts); the
  function locks `pg_advisory_xact_lock(hashtext('fee_desk_open_dues:'||tenant||':'||ay))` (the key
  `fee_desk_replace_open_dues` already uses) and replaces only `(tenant, ay, student_id ∈ receipt)`.
  `null` = refuse (dues must never silently go unmaintained); an empty array = "this student owes nothing".
  A pure-SQL trigger cannot do this: billed and concession come from Masters + transport + adjustments in TS.
- Returns `{ok, id, receipt_no, updated_at, duplicate}`.

### 5.2 `fee_voucher_void(p_tenant, p_voucher_id, p_base_updated_at, p_reason, p_actor, p_open_dues jsonb)`

`select … for update`; refuse if `updated_at <> p_base_updated_at` (`stale`) or already voided
(`already_voided`, idempotent `ok:true`). Sets `voided_at = now()`, `updated_at = now()`; cheques of the
receipt not cleared/bounced → `bounced` ("Receipt voided"); deletes its `fee_desk_plan_allocations`;
reopens `completed` plans no longer fully paid (needs the plan's paid map — pass `p_plans_reopen text[]`
from the caller or do it in SQL from allocations); replaces the students' open dues as 5.1. The ledger
reversal already follows from the `fee_desk_vouchers` UPDATE trigger. **`voided_at` can never go back
to null** — add a BEFORE UPDATE trigger on `fee_desk_vouchers` refusing `voided_at` non-null → null (and
`whatsapp_sent_at` non-null → null) outside `bhb.receipt_edit = 'repair'`; that single trigger also
closes risk R1 for every old writer still running during the migration.

### 5.3 `fee_voucher_mark(p_tenant, p_voucher_id, p_field text, p_at timestamptz)`

One-way stamps: `whatsapp_sent_at` (null → value only). No base needed (monotonic).

### 5.4 Ancillary (5.1c/5.1d, not 5.1b)

Per-row RPCs with a base revision, replacing `pushFeeDeskAncillaryToDb`'s whole-array upsert:
`fee_cheque_transition(id, base, to_status, fields)`, `fee_day_close_write(row, base)`,
`fee_charge_voucher_write/void`, `fee_installment_plan_write/cancel`, `fee_carried_forward_write/void`,
`fee_manual_book_write`. `fee_desk_charge_voucher_lines` keeps `replace_child_rows`, scoped to one charge.

### 5.5 Callers, in conversion order (5.1b)

1. **`settlePaymentLinkWithWhatsApp`** (`lib/paymentSettlement.server.ts`) — covers W1–W5 at once:
   build the voucher with `collectPayment`'s pure part on a per-household SQL read (this family's
   receipts + dues inputs), call `fee_voucher_write`, read-back stays; delete `pushFeesRemoteServer(loadFees())`.
2. **`POST /api/v1/staff/fees/collect`** (W6) — same, keyed on `transactionId: clientRef` for replay.
3. **`postReceiptsTogether`** (W7) — a `fee_voucher_write_many(p_tenant, p_vouchers jsonb)` wrapper
   (one transaction, all-or-none, same idempotency per `transaction_id`), replacing both pushes and
   `forgetInMemory`/`dropAndRehydrate`.
4. **Refund voids** W8, W9 — `fee_voucher_void` with the receipt's stored `updated_at` as base.
   `voidVoucher`'s other effects (`reverseFeeCollectionInBooks` on the legacy desk book, and
   `revertRegistrationPaymentForVoidedReceipt` in admissions, `lib/fees.ts:3790-3800`) must be kept
   by the caller — **not traced further in this step**.
5. **Cashfree registration capture** W10 — first time this path writes the fee desk at all.
6. Delete W13 (`ensureDeskCutover` fee branch), W14 (`saveOpsFees`), W18 (`sendSisFeeReceiptOnWhatsApp`).
7. `rebuildFeeOpenDuesCache` stays only behind W12 (manual full rebuild), reading its inputs by SQL,
   not from the instance copy; `pushFeeDeskToDb` stops calling it once 5.1c lands.
8. Then 5.1c (browser POST: header LWW and ancillary replace refused), then the browser screens (5.1d).

Every converted caller stops calling `ensureFeesHydratedServer`; the readers in §3 move with
5.1d/4.1 (they are reads and do not block the writes).

---

## 6. 5.1 risks

| # | Risk | Where | Severity |
|---|---|---|---|
| R1 | **A stale whole-desk push un-voids a receipt.** `replace_fee_desk_voucher_lines` overwrites every header column including `voided_at` and `whatsapp_sent_at` from the pushing copy; a copy taken before a void writes `voided_at = null`, and the ledger trigger then re-posts the collection. Any browser tab, and W1–W9 (W8/W9 with a ≤ 45 s-old copy). No guard exists today (the household guard at `feesNormalized.server.ts:437-445` is the only header field the server keeps). | migration `20260907130000:83-…`, `voucherToRows` `feesNormalized.server.ts:90-115` | **High** — money; the trigger in 5.2 closes it for old writers too |
| R2 | `fee_desk_open_dues` is rebuilt from the instance copy, not from what was just written; proven stale for one family today (₹1,800, §1). Any fee push can also re-open dues another instance cleared, or miss transport/adjustment/Masters changes (nothing rebuilds on those). | `feesDeskAncillary.server.ts:545-631` | **High** — parents are quoted and reminded on this table |
| R3 | A server receipt that is never pushed is lost (W10 today; any future `collectPayment` caller that forgets the push). | `lib/fees.ts:1544-1548` | High (latent) |
| R4 | Receipt numbers are minted from the instance copy; two instances can mint the same number — only `unique (tenant_id, receipt_no)` stops it, after the money is taken. | `nextReceiptNo` `lib/fees.ts:3265` | Medium |
| R5 | Ancillary rows: only status/void regressions are refused (10 Oct); other fields (manual book label/active, day close remarks before a status change, plan_json edits, carried-forward amount/label, cheque bank/date) are plain LWW from any copy; the instance's ancillary copy is not in the mirror probe. Every push rewrites `updated_at` on all rows (all 76 carried-forward rows carry 14 Oct 05:08:14), so `updated_at` is **not** usable as a base revision until the writers stop stamping unchanged rows. | `feesDeskAncillary.server.ts:123-378` | Medium |
| R6 | Every whole-desk push UPDATEs all ~700 headers (fires the ledger trigger ~700× per push, swallowing errors) and rewrites `updated_at` — today's `fee_desk_vouchers.updated_at` carries no information (all 698 = 14 Oct 05:08:13). 5.1b's base revision must start from rows the new RPC stamps; the first `fee_voucher_void` against a row last touched by an old push is fine (base = stored value) but a browser holding an older read will be refused — expected. | `replace_fee_desk_voucher_lines` | Medium (cost + no history) |
| R7 | W5 pushes the whole desk once per pay-link in a multi-link auto-pay charge. | `feeAutopay.server.ts:870-885` | Low (0 charges so far) |
| R8 | A parent's browser GET of `/pay/cf/[orderId]` can settle and push the whole desk (W4) — a page view with a whole-desk write behind it. | `app/pay/cf/[orderId]/page.tsx:64` | Low/medium |
| R9 | `sis_merge_students` UPDATEs `fee_desk_voucher_lines.student_id`; since 7 Sep the append-only trigger refuses that, so merging a child who has receipts fails as a whole. **Not proven in production** (would need a merge attempt). | `20260818070000_sis_merge_students.sql:162` vs `20260907130000:65-73` | Medium (students desk) |
| R10 | `ensureFeesHydratedServer` reads all 13 tables on every call — ~324 whole-desk reads a day; no TTL, probe or in-flight dedupe, so concurrent staff-app requests each pull the book. | `feesPersistence.server.ts:40-91` | Cost/latency (S6) |
| R11 | `repair_fee_receipt_allocation` (W15) and `sisSeparate` (W16) change what dues a receipt clears / which family it belongs to without rebuilding open dues or bumping `fee_desk_sync_meta`, so `erp_versions` does not move for them. | `repair-receipt/route.ts:106`, `sisSeparate.server.ts:160` | Low |
| R12 | Deploy order: 5.1b's RPCs must be applied before the code; the code must fail closed (`ok:false`, logged, gateway event recorded, never fall back to `pushFeesRemoteServer`) — for webhooks, failing closed must still return 2xx-with-recorded-failure as today, or Cashfree retries and the replay must be idempotent on `transaction_id`. | 5.1b | Process |

---

## 7. Re-measure (needs a logged-in `gcloud`)

```bash
gcloud auth login   # interactive; then:
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="school-erp-web"
  AND httpRequest.requestMethod="POST" AND (httpRequest.requestUrl:"/api/school-data/fees-vouchers"
  OR httpRequest.requestUrl:"/api/v1/staff/fees/collect" OR httpRequest.requestUrl:"/api/payments/"
  OR httpRequest.requestUrl:"/api/fees/" OR httpRequest.requestUrl:"/api/payouts/webhook")' \
  --freshness=7d --format='value(httpRequest.requestUrl)' --limit=100000 \
  | sed -E 's#https?://[^/]+##; s#\?.*##' | sort | uniq -c | sort -rn
```

Supabase side (any 24 h window; the API caps at 24 h):
`select log_attributes['request.path'] p, count() from logs where source='edge_logs' and log_attributes['request.method']='POST' and log_attributes['request.path'] like '%fee%' group by p`.

Ratchet: `fee_whole_desk_push` in `scripts/ratchets.txt` counts the 12 call sites of
`pushFeesRemoteServer(` / `pushFeeDeskToDb(` / `rebuildFeeOpenDuesCache(` in `apps/web/src`
(budget 12 on 15 Oct; target 1 — the manual rebuild — after 5.1e).
