/**
 * Director console — server wiring for the conversational assistant.
 *
 * Runs a Claude (Anthropic) tool-use agent whose tools read the ERP's own
 * grounded data (collections, attendance, dues, defaulters, students, staff)
 * and draft — never send — outward messages. The pure agent loop, the tool
 * schemas and the contracts live in officeAssistant.ts; this file supplies
 * the real model call, the real tool executors, usage logging and the
 * send-on-approve path. It is never auto-called: the n8n relay POSTs the
 * director's text to /api/office/assistant.
 *
 * Models: default Claude Sonnet 5.5 (OFFICE_ASSISTANT_MODEL), matching the
 * staff room's cost pattern on the $100 credit; effort low (tunable). Nothing
 * outward is sent here except from an explicit approve_draft action.
 */

import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  OFFICE_ASSISTANT_TOOLS,
  buildSystemPrompt,
  replyLanguage,
  runAssistantLoop,
  type AssistantInput,
  type AssistantOutput,
  type AssistantDraft,
  type CallModel,
  type LlmMessage,
  type LlmResponse,
  type RunTool,
  type ToolRunResult,
} from "@/lib/officeAssistant";

import { TENANT } from "@/lib/types";
import { getServerTenantContext } from "@/lib/serverTenant";
import { checkAiBudget, noteAiBudgetUse } from "@/lib/aiBudget.server";
import { recordAiGeneration } from "@/lib/aiGenerations.server";
import { askErpGrounded } from "@/lib/erpCommands.server";
import { buildPrincipalSnapshot } from "@/lib/principalSnapshot.server";
import { listLiveDefaulters } from "@/lib/playbook";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis, householdWhatsApp } from "@/lib/sis";
import { loadMasters, currentAcademicYearCode } from "@/lib/masters";
import { staffAttendanceStatusForWa } from "@/lib/staffAttendance.server";
import { readStaffHrServer } from "@/lib/api/v1/staffLeave";
import { renderTableReportPdf } from "@/lib/reportPdf.server";
import { reportFilename, type ReportTable } from "@/lib/erpReports";
import { buildDailyBrief } from "@/lib/dailyBrief.server";
import { renderDailyBriefPdf } from "@/lib/dailyBriefPdf.server";
import { resolveWaAudience } from "@/lib/waAudienceResolve.server";
import { sendTemplateToAudience } from "@/lib/waAudienceSend.server";
import { POST as dispatchPost } from "@/app/api/wa/dispatch/route";

const REQUESTER = "office_assistant";

function model(): string {
  return (process.env.OFFICE_ASSISTANT_MODEL || "claude-sonnet-5-5").trim();
}
function effort(): string {
  return (process.env.OFFICE_ASSISTANT_EFFORT || "low").trim();
}

function rupees(paise: number): string {
  return "Rs. " + Math.round((paise || 0) / 100).toLocaleString("en-IN");
}

function istTodayIso(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/* ── Cost ledger (office_ai_usage, same table the staff room writes) ───── */

// Claude Sonnet 5.5 list price, US$/token. Haiku/other models would differ;
// the figure is an estimate for the $100-credit ledger, not a bill.
const PRICE: Record<string, { in: number; out: number; cacheRead: number }> = {
  "claude-sonnet-5-5": { in: 2e-6, out: 10e-6, cacheRead: 0.2e-6 },
  "claude-haiku-5-5": { in: 0.1e-6, out: 0.5e-6, cacheRead: 0.01e-6 },
  "claude-opus-5-5": { in: 4e-6, out: 20e-6, cacheRead: 0.2e-6 },
};

async function logUsage(
  usages: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }[],
  usedModel: string,
): Promise<void> {
  const inTok = usages.reduce((s, u) => s + (u.input_tokens ?? 0), 0);
  const outTok = usages.reduce((s, u) => s + (u.output_tokens ?? 0), 0);
  const cacheRead = usages.reduce((s, u) => s + (u.cache_read_input_tokens ?? 0), 0);
  const cacheCreate = usages.reduce((s, u) => s + (u.cache_creation_input_tokens ?? 0), 0);
  const p = PRICE[usedModel] || PRICE["claude-sonnet-5-5"];
  const cost = inTok * p.in + outTok * p.out + cacheRead * p.cacheRead;

  // ai_generations — so the shared daily AI budget counts Claude calls too.
  await recordAiGeneration({
    route: "office/assistant",
    promptVersion: "office-assistant-v1",
    tier: "pro",
    engine: "anthropic",
    model: usedModel,
    status: "ok",
    inputText: "",
    outputText: "",
    promptTokens: inTok + cacheRead + cacheCreate,
    completionTokens: outTok,
    latencyMs: 0,
    requester: REQUESTER,
  }).catch((e) => console.error("[office-assistant] ai_generations log failed", e));
  noteAiBudgetUse(REQUESTER, inTok + outTok + cacheRead + cacheCreate);

  // office_ai_usage — the staff room's own US$ ledger the director watches.
  try {
    const ctx = await getServerTenantContext();
    if (ctx) {
      await ctx.sb.from("office_ai_usage").insert({
        tenant_id: ctx.tenantId,
        workflow: "director_assistant",
        role: "assistant",
        model: usedModel,
        input_tokens: inTok,
        output_tokens: outTok,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreate,
        est_cost_usd: Number(cost.toFixed(6)),
      });
    }
  } catch (e) {
    console.error("[office-assistant] office_ai_usage log failed", e);
  }
}

/* ── Grounded tool executors ──────────────────────────────────────────── */

type Pending = {
  file?: { caption: string; fileBase64: string; mime: string; filename: string };
  draft?: { draft: AssistantDraft; summary: string };
  ranAction: boolean;
};

async function classIdForLabel(label: string): Promise<{ id: string; name: string } | null> {
  const masters = loadMasters();
  const want = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const c of masters.classes ?? []) {
    const n = (c.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (n && (n === want || n.includes(want) || want.includes(n))) return { id: c.id, name: c.name };
  }
  return null;
}

/** A plain name/admission-number match over the active roster. */
function findStudents(query: string, limit = 3): { id: string; name: string; admissionNo: string; classLabel: string; householdId: string }[] {
  const sis = loadSis();
  const masters = loadMasters();
  const ay = currentAcademicYearCode(masters);
  const q = query.trim().toLowerCase();
  const tokens = q.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const classLabel = (st: { classId?: string; sectionId?: string }) => {
    const c = (masters.classes ?? []).find((x) => x.id === st.classId);
    const s = (masters.sections ?? []).find((x) => x.id === st.sectionId);
    return [c?.name, s?.name].filter(Boolean).join("-");
  };
  const scored: { st: { id: string; fullName?: string; admissionNo?: string; classId?: string; sectionId?: string; householdId?: string; academicYearCode?: string; status?: string }; score: number }[] = [];
  for (const st of sis.students as unknown as { id: string; fullName?: string; admissionNo?: string; classId?: string; sectionId?: string; householdId?: string; academicYearCode?: string; status?: string }[]) {
    if (st.academicYearCode && st.academicYearCode !== ay) continue;
    if (st.status && st.status !== "active") continue;
    const adm = (st.admissionNo || "").toLowerCase();
    const name = (st.fullName || "").toLowerCase();
    let score = 0;
    if (adm && adm === q) score = 100;
    else if (tokens.length && tokens.every((t) => name.split(/\s+/).some((w) => w.startsWith(t)))) score = 50;
    else if (adm && adm.includes(q)) score = 20;
    if (score > 0) scored.push({ st, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ st }) => ({
    id: st.id,
    name: st.fullName || st.id,
    admissionNo: st.admissionNo || "",
    classLabel: classLabel(st),
    householdId: st.householdId || "",
  }));
}

function householdMobileFor(householdId: string): string {
  const sis = loadSis();
  const hh = (sis.households as unknown as { id: string }[]).find((h) => h.id === householdId);
  return hh ? householdWhatsApp(hh as unknown as Parameters<typeof householdWhatsApp>[0]) : "";
}

function makeReportTable(
  kind: "collection" | "attendance" | "defaulters",
  snap: Awaited<ReturnType<typeof buildPrincipalSnapshot>>,
  defaulters: ReturnType<typeof listLiveDefaulters>,
  todayIso: string,
): ReportTable {
  if (kind === "collection") {
    const rows = snap.fees.todayByMode.map((m) => ({ mode: m.label, amount: rupees(m.paise) }));
    return {
      kind: "collection",
      title: "Collection today",
      subtitle: `${TENANT.nameDisplay} · ${todayIso}`,
      columns: [
        { key: "mode", label: "Mode", width: 60 },
        { key: "amount", label: "Amount", align: "right", width: 40 },
      ],
      rows,
      footer: [`Total today: ${rupees(snap.fees.todayCollectionPaise)}`, `Month to date: ${rupees(snap.fees.mtdCollectionPaise)}`],
      filename: reportFilename("collection", "school", todayIso),
      summary: `Collection today ${rupees(snap.fees.todayCollectionPaise)} (MTD ${rupees(snap.fees.mtdCollectionPaise)}).`,
    };
  }
  if (kind === "attendance") {
    const a = snap.attendance;
    return {
      kind: "attendance_register",
      title: "Attendance today",
      subtitle: `${TENANT.nameDisplay} · ${a.date || todayIso}`,
      columns: [
        { key: "metric", label: "Metric", width: 60 },
        { key: "value", label: "Count", align: "right", width: 40 },
      ],
      rows: [
        { metric: "Present", value: String(a.studentPresent) },
        { metric: "Absent", value: String(a.studentAbsent) },
        { metric: "On leave", value: String(a.studentLeave) },
        { metric: "Marked %", value: `${a.studentMarkedPct}%` },
        { metric: "Sections marked", value: String(a.sectionsMarked) },
      ],
      footer: [`Active students: ${snap.students.activeCount}`],
      filename: reportFilename("attendance_register", "school", a.date || todayIso),
      summary: `Attendance ${a.studentPresent} present / ${a.studentAbsent} absent (${a.studentMarkedPct}% marked).`,
    };
  }
  // defaulters
  const rows = defaulters.slice(0, 200).map((d) => ({
    name: d.fullName,
    class: d.classLabel,
    days: String(d.overdueDays),
    overdue: rupees(d.overdueAmountPaise),
  }));
  const total = defaulters.reduce((s, d) => s + d.overdueAmountPaise, 0);
  return {
    kind: "defaulters",
    title: "Fee defaulters",
    subtitle: `${TENANT.nameDisplay} · ${todayIso}`,
    columns: [
      { key: "name", label: "Student", width: 40 },
      { key: "class", label: "Class", width: 20 },
      { key: "days", label: "Days", align: "right", width: 15 },
      { key: "overdue", label: "Overdue", align: "right", width: 25 },
    ],
    rows,
    footer: [`${defaulters.length} defaulter household(s)`, `Total overdue: ${rupees(total)}`],
    filename: reportFilename("defaulters", "school", todayIso),
    summary: `${defaulters.length} defaulters, ${rupees(total)} overdue.`,
  };
}

function buildToolExecutor(pending: Pending, todayIso: string): RunTool {
  return async (name, input): Promise<ToolRunResult> => {
    switch (name) {
      case "ask_erp": {
        const question = String(input.question || "");
        const out = await askErpGrounded({ text: question, todayIso });
        if (!out) return { text: "That question could not be answered from the school's records. Say it is not on record." };
        return { text: out.text };
      }
      case "school_snapshot": {
        const s = await buildPrincipalSnapshot();
        const lines = [
          `Collection today: ${rupees(s.fees.todayCollectionPaise)} (MTD ${rupees(s.fees.mtdCollectionPaise)})`,
          `Open dues: ${rupees(s.fees.openDuesPaise)} across ${s.fees.defaulterHouseholds} defaulter household(s)`,
          `Attendance ${s.attendance.date}: ${s.attendance.studentPresent} present, ${s.attendance.studentAbsent} absent, ${s.attendance.studentLeave} leave (${s.attendance.studentMarkedPct}% marked, ${s.attendance.sectionsMarked} sections)`,
          `Staff: ${s.staff.presentToday} present / ${s.staff.absentToday} absent of ${s.staff.activeCount} active`,
          `Active students: ${s.students.activeCount}`,
          `Admissions: pipeline ${s.admissions.pipeline}, enrolled ${s.admissions.enrolled}, follow-ups due ${s.admissions.followUpsDue}`,
        ];
        if (s.fees.storeDuesPaise != null) lines.push(`Store dues: ${rupees(s.fees.storeDuesPaise)} (${s.fees.storeDueStudents} students)`);
        return { text: lines.join("\n") };
      }
      case "defaulters": {
        await ensureSchoolMirrorHydrated();
        const classLabel = input.class_label ? String(input.class_label).toLowerCase() : null;
        const limit = Math.max(1, Math.min(100, Number(input.limit) || 20));
        let list = listLiveDefaulters();
        if (classLabel) list = list.filter((d) => (d.classLabel || "").toLowerCase().includes(classLabel));
        if (!list.length) return { text: classLabel ? "No defaulters in that class." : "No defaulters on record." };
        const shown = list.slice(0, limit);
        const body = shown.map((d) => `${d.fullName} (${d.classLabel}) — ${d.overdueDays}d overdue, ${rupees(d.overdueAmountPaise)}`).join("\n");
        return { text: `${list.length} defaulter household(s). Showing ${shown.length}:\n${body}` };
      }
      case "student_lookup": {
        await ensureSchoolMirrorHydrated();
        const matches = findStudents(String(input.query || ""));
        if (!matches.length) return { text: "No student matches that name or admission number." };
        const defaulters = listLiveDefaulters();
        const lines = matches.map((m) => {
          const due = defaulters.find((d) => d.studentId === m.id);
          const mobile = householdMobileFor(m.householdId);
          return [
            `${m.name} (${m.admissionNo || "no adm no"}) — ${m.classLabel || "class unknown"}`,
            `  Dues: ${due ? `${rupees(due.overdueAmountPaise)} overdue (${due.overdueDays}d)` : "no overdue dues on record"}`,
            `  WhatsApp: ${mobile || "not on record"}`,
          ].join("\n");
        });
        return { text: lines.join("\n\n") };
      }
      case "staff_lookup": {
        const masters = loadMasters();
        const q = String(input.query || "").toLowerCase().trim();
        const tokens = q.split(/\s+/).filter(Boolean);
        const staff = (masters.staff ?? []).filter((s) => {
          const n = (s.fullName || "").toLowerCase();
          return tokens.length ? tokens.every((t) => n.split(/\s+/).some((w) => w.startsWith(t))) : false;
        }).slice(0, 3);
        if (!staff.length) return { text: "No staff member matches that name." };
        let hr: Awaited<ReturnType<typeof readStaffHrServer>> | null = null;
        try { hr = await readStaffHrServer(); } catch { hr = null; }
        const lines: string[] = [];
        for (const s of staff) {
          let status = "";
          try { status = await staffAttendanceStatusForWa(s.id); } catch { status = ""; }
          const leaves = hr && hr.ok
            ? (hr.state.leaveRequests || []).filter((l) => l.staffId === s.id).slice(0, 3)
              .map((l) => `${l.fromDate}→${l.toDate} (${l.status})`)
            : [];
          lines.push([
            `${s.fullName}${s.empCode ? ` (${s.empCode})` : ""}${s.status && s.status !== "active" ? ` — ${s.status}` : ""}`,
            status ? `  ${status}` : "",
            leaves.length ? `  Leave: ${leaves.join("; ")}` : "",
          ].filter(Boolean).join("\n"));
        }
        return { text: lines.join("\n\n") };
      }
      case "list_tasks": {
        const which = String(input.which || "open");
        const ctx = await getServerTenantContext();
        if (!ctx) return { text: "Task list is unavailable right now." };
        let q = ctx.sb.from("office_tasks").select("id,to_role,title,due_on,approval_state,source,status").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: true }).limit(100);
        if (which === "pending_drafts") q = q.eq("approval_state", "pending").eq("status", "open");
        else q = q.in("status", ["open", "doing"]);
        const { data, error } = await q;
        if (error) return { text: "Could not read tasks: " + error.message };
        const rows = (data ?? []) as { id: number; to_role: string; title: string; due_on: string | null; approval_state: string }[];
        if (!rows.length) return { text: which === "pending_drafts" ? "No drafts waiting." : "No open tasks." };
        return { text: rows.map((t) => `#${t.id} [${t.to_role}] ${t.title}${t.due_on ? ` (due ${t.due_on})` : ""}${t.approval_state === "pending" ? " — waiting for you" : ""}`).join("\n") };
      }
      case "report": {
        const kind = String(input.kind || "");
        const masters = loadMasters();
        try {
          if (kind === "daily_brief") {
            const brief = await buildDailyBrief({ dateIso: todayIso });
            const buf = await renderDailyBriefPdf(brief, masters);
            pending.file = { caption: `Daily brief ${todayIso}`, fileBase64: Buffer.from(buf).toString("base64"), mime: "application/pdf", filename: `daily-brief_${todayIso}.pdf` };
            return { text: "The daily brief PDF is ready — it will be delivered to you.", terminal: true };
          }
          if (kind === "collection" || kind === "attendance" || kind === "defaulters") {
            await ensureSchoolMirrorHydrated();
            const snap = await buildPrincipalSnapshot();
            const defaulters = kind === "defaulters" ? listLiveDefaulters() : [];
            const table = makeReportTable(kind, snap, defaulters, todayIso);
            const buf = await renderTableReportPdf(table, { requestedBy: "Director", channel: "whatsapp", atIso: new Date().toISOString() }, masters);
            pending.file = { caption: table.summary, fileBase64: Buffer.from(buf).toString("base64"), mime: "application/pdf", filename: table.filename };
            return { text: `The ${kind} report PDF is ready — it will be delivered to you.`, terminal: true };
          }
          if (kind === "fleet") {
            const out = await askErpGrounded({ text: "transport fleet summary today", todayIso });
            return { text: (out?.text || "Fleet details are not on record.") + "\n\n(A fleet PDF is not wired yet — this is the live summary.)" };
          }
        } catch (e) {
          return { text: `Could not build the ${kind} report: ${e instanceof Error ? e.message : String(e)}` };
        }
        return { text: "Unknown report kind." };
      }
      case "draft_notice": {
        const audience = String(input.audience || "");
        const title = String(input.title || "").trim();
        const body = String(input.body || "").trim();
        if (!body) return { text: "The notice body is empty — ask the director what to say." };
        if (audience === "class") {
          const label = String(input.class_label || "");
          const cls = await classIdForLabel(label);
          if (!cls) return { text: `No class matches "${label}".` };
          pending.draft = {
            draft: { audience: "class", recipientLabel: `${cls.name} parents`, recipient: { classLabel: cls.name, classId: cls.id } as AssistantDraft["recipient"], title, body, channel: "whatsapp", meta: { templateFamily: "comms_notice" } },
            summary: `Notice to ${cls.name} parents: ${title}`,
          };
          return { text: `Draft notice for ${cls.name} parents is ready for your approval.`, terminal: true };
        }
        pending.draft = {
          draft: { audience: "whole_school", recipientLabel: "All parents", recipient: {}, title, body, channel: "whatsapp", meta: { templateFamily: "comms_notice" } },
          summary: `School-wide notice: ${title}`,
        };
        return { text: "Draft school-wide notice is ready for your approval.", terminal: true };
      }
      case "draft_fee_reminder": {
        const custom = input.body ? String(input.body) : "";
        if (input.student_query) {
          await ensureSchoolMirrorHydrated();
          const m = findStudents(String(input.student_query), 1)[0];
          if (!m) return { text: "No student matches that name or admission number." };
          const mobile = householdMobileFor(m.householdId);
          const defaulters = listLiveDefaulters();
          const due = defaulters.find((d) => d.studentId === m.id);
          const body = custom || `This is a gentle reminder regarding the pending school fees for ${m.name}${due ? ` (${rupees(due.overdueAmountPaise)} overdue)` : ""}. Kindly clear at your earliest convenience. Thank you.`;
          pending.draft = {
            draft: { audience: "parent", recipientLabel: `${m.name}'s family`, recipient: { studentId: m.id, mobile }, title: "Fee reminder", body, channel: "whatsapp", meta: { templateFamily: "comms_notice" } },
            summary: `Fee reminder to ${m.name}'s family`,
          };
          return { text: `Draft fee reminder for ${m.name}'s family is ready for your approval.`, terminal: true };
        }
        const label = input.class_label ? String(input.class_label) : "";
        const cls = label ? await classIdForLabel(label) : null;
        if (label && !cls) return { text: `No class matches "${label}".` };
        const body = custom || "This is a gentle reminder regarding pending school fees. Kindly clear the dues at your earliest convenience. Thank you.";
        pending.draft = {
          draft: { audience: "class", recipientLabel: cls ? `${cls.name} fee defaulters` : "All fee defaulters", recipient: cls ? ({ classLabel: cls.name, classId: cls.id } as AssistantDraft["recipient"]) : {}, title: "Fee reminder", body, channel: "whatsapp", meta: { templateFamily: "comms_notice", feeReminder: true } },
          summary: cls ? `Fee reminder to ${cls.name} defaulters` : "Fee reminder to all defaulters",
        };
        return { text: `Draft fee reminder is ready for your approval.`, terminal: true };
      }
      case "draft_parent_message": {
        await ensureSchoolMirrorHydrated();
        const text = String(input.text || "").trim();
        if (!text) return { text: "The message is empty." };
        const m = findStudents(String(input.student_query || ""), 1)[0];
        if (!m) return { text: "No student matches that name or admission number." };
        const mobile = householdMobileFor(m.householdId);
        if (!mobile) return { text: `${m.name}'s family has no WhatsApp number on record — tell the director.` };
        pending.draft = {
          draft: { audience: "parent", recipientLabel: `${m.name}'s family`, recipient: { studentId: m.id, mobile }, title: "Message", body: text, channel: "whatsapp", meta: { templateFamily: "comms_notice" } },
          summary: `Message to ${m.name}'s family`,
        };
        return { text: `Draft message to ${m.name}'s family is ready for your approval.`, terminal: true };
      }
      case "draft_staff_message": {
        const masters = loadMasters();
        const text = String(input.text || "").trim();
        if (!text) return { text: "The message is empty." };
        const q = String(input.staff_query || "").toLowerCase().trim();
        const tokens = q.split(/\s+/).filter(Boolean);
        const s = (masters.staff ?? []).find((x) => {
          const n = (x.fullName || "").toLowerCase();
          return tokens.length ? tokens.every((t) => n.split(/\s+/).some((w) => w.startsWith(t))) : false;
        });
        if (!s) return { text: "No staff member matches that name." };
        const mobile = [s.mobile, s.altMobile].map((x) => (x || "").replace(/\D/g, "").slice(-10)).find((x) => x.length === 10) || "";
        if (!mobile) return { text: `${s.fullName} has no mobile on record — tell the director.` };
        pending.draft = {
          draft: { audience: "staff", recipientLabel: s.fullName, recipient: { staffId: s.id, mobile }, title: "Message", body: text, channel: "whatsapp", meta: { templateFamily: "comms_notice" } },
          summary: `Message to ${s.fullName}`,
        };
        return { text: `Draft message to ${s.fullName} is ready for your approval.`, terminal: true };
      }
      case "create_task": {
        const ctx = await getServerTenantContext();
        if (!ctx) return { text: "Could not create the task right now." };
        const title = String(input.title || "").trim().slice(0, 80);
        if (!title) return { text: "A task needs a title." };
        const { data, error } = await ctx.sb.from("office_tasks").insert({
          tenant_id: ctx.tenantId,
          from_role: "director",
          to_role: String(input.to_role || "director").slice(0, 40),
          title,
          detail: String(input.detail || "").slice(0, 600),
          status: "open",
          source: "assistant",
          approval_state: "none",
          due_on: input.due_on ? String(input.due_on).slice(0, 10) : null,
          payload: { kind: "director_task" },
        }).select("id").maybeSingle();
        if (error) return { text: "Could not create the task: " + error.message };
        pending.ranAction = true;
        return { text: `Task #${(data as { id?: number } | null)?.id ?? "?"} created for ${String(input.to_role || "director")}.` };
      }
      case "close_task": {
        const ctx = await getServerTenantContext();
        if (!ctx) return { text: "Could not update the task right now." };
        const id = Number(input.id);
        const now = new Date().toISOString();
        const { error } = await ctx.sb.from("office_tasks").update({ status: "done", decided_by: "director", decided_at: now, updated_at: now }).eq("tenant_id", ctx.tenantId).eq("id", id);
        if (error) return { text: "Could not close the task: " + error.message };
        pending.ranAction = true;
        return { text: `Task #${id} closed.` };
      }
      case "snooze_task": {
        const ctx = await getServerTenantContext();
        if (!ctx) return { text: "Could not update the task right now." };
        const id = Number(input.id);
        const tomorrow = istTodayIso(new Date(Date.now() + 86_400_000));
        const { error } = await ctx.sb.from("office_tasks").update({ due_on: tomorrow, updated_at: new Date().toISOString() }).eq("tenant_id", ctx.tenantId).eq("id", id);
        if (error) return { text: "Could not snooze the task: " + error.message };
        pending.ranAction = true;
        return { text: `Task #${id} snoozed to ${tomorrow}.` };
      }
      default:
        return { text: `Unknown tool: ${name}` };
    }
  };
}

/* ── The send-on-approve path (the only place anything goes out) ──────── */

export async function sendApprovedDraft(
  draft: AssistantDraft,
  opts: { originUrl: string },
): Promise<{ ok: boolean; text: string }> {
  const schoolName = TENANT.nameDisplay;
  const title = (draft.title || "Notice").slice(0, 120);
  const body = draft.body.slice(0, 3000);

  if (draft.audience === "whole_school" || draft.audience === "class") {
    const classId = (draft.recipient as { classId?: string }).classId;
    const spec = classId
      ? { kind: "parents" as const, classIds: [classId], sectionIds: [] }
      : { kind: "parents" as const, classIds: [] as string[], sectionIds: [] as string[] };
    const resolution = await resolveWaAudience(spec);
    if (!resolution.recipients.length) return { ok: false, text: "No reachable parents found for that audience — nothing sent." };
    const res = await sendTemplateToAudience({
      recipients: resolution.recipients,
      familyKey: "comms_notice",
      variables: { noticeTitle: title, noticeBody: body, schoolName },
      originUrl: opts.originUrl,
      audienceKind: draft.audience === "class" ? "class_notice" : "notice",
    });
    const parts = [`Sent to ${res.sent}`];
    if (res.failed) parts.push(`${res.failed} failed`);
    if (res.deferred) parts.push(`${res.deferred} deferred (quiet hours)`);
    if (res.skippedNoTemplate) parts.push(`${res.skippedNoTemplate} without an approved template`);
    return { ok: res.sent > 0, text: `${draft.recipientLabel}: ${parts.join(", ")}.${res.error ? ` (${res.error})` : ""}` };
  }

  // Single parent / staff — one template message via the dispatch route.
  const mobile = (draft.recipient.mobile || "").replace(/\D/g, "").slice(-10);
  if (mobile.length !== 10) return { ok: false, text: "No valid mobile on the draft — nothing sent." };
  const dispatchSecret = process.env.WA_DISPATCH_SECRET?.trim();
  const dispatchUrl = new URL("/api/wa/dispatch", opts.originUrl).toString();
  const req = new Request(dispatchUrl, {
    method: "POST",
    headers: { "content-type": "application/json", ...(dispatchSecret ? { "x-wa-dispatch-secret": dispatchSecret } : {}) },
    body: JSON.stringify({
      module: "comms",
      messages: [{
        mobile,
        template: { name: "bhb_school_notice", language: "hi", variables: { schoolName, noticeTitle: title, noticeBody: body }, variableKeys: ["schoolName", "noticeTitle", "noticeBody"] },
      }],
    }),
  });
  try {
    const res = await dispatchPost(req);
    const json = (await res.json()) as { results?: { status?: string; error?: string }[]; error?: string };
    const r = json.results?.[0];
    if (r?.status === "sent") return { ok: true, text: `Sent to ${draft.recipientLabel}.` };
    if (r?.status === "deferred") return { ok: false, text: `Held (family quiet hours) — it was not sent. ${r.error || ""}`.trim() };
    return { ok: false, text: `Not sent to ${draft.recipientLabel}: ${r?.error || json.error || "unknown error"}.` };
  } catch (e) {
    return { ok: false, text: `Send failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/* ── Anthropic model call (mapped onto the pure loop's LlmResponse) ────── */

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

function makeCallModel(system: string): CallModel {
  return async (messages: LlmMessage[]): Promise<LlmResponse> => {
    const res = await anthropic().messages.create({
      model: model(),
      max_tokens: 4096,
      system,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      output_config: { effort: effort() } as any,
      tools: OFFICE_ASSISTANT_TOOLS as unknown as Anthropic.Tool[],
      messages: messages as unknown as Anthropic.MessageParam[],
    });
    return res as unknown as LlmResponse;
  };
}

/* ── Entry point ──────────────────────────────────────────────────────── */

export async function runOfficeAssistant(
  input: AssistantInput,
  opts: { originUrl: string },
): Promise<AssistantOutput> {
  // Structured action (a button tap) — no model, just do it.
  if (input.action) {
    if (input.action.kind === "approve_draft") {
      if (!input.action.draft || !input.action.draft.body) {
        return { kind: "error", text: "That draft could not be found — nothing was sent." };
      }
      const r = await sendApprovedDraft(input.action.draft, { originUrl: opts.originUrl });
      return { kind: "action_done", text: r.text };
    }
    return { kind: "action_done", text: "Draft rejected — nothing was sent." };
  }

  const text = (input.text || "").trim();
  if (!text) return { kind: "answer", text: "Yes? Ask me anything about the school, or tell me what to send or do." };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { kind: "error", text: "The assistant is not configured yet (no API key). Please set it up." };
  }

  const budget = await checkAiBudget(REQUESTER);
  if (!budget.ok) return { kind: "error", text: budget.reason };

  const lang = replyLanguage(text, input.locale);
  const todayIso = istTodayIso();
  const system = buildSystemPrompt({ schoolName: TENANT.nameDisplay, todayIso, language: lang });
  const pending: Pending = { ranAction: false };
  const runTool = buildToolExecutor(pending, todayIso);

  let outcome;
  try {
    outcome = await runAssistantLoop({
      system,
      firstUserText: text,
      tools: OFFICE_ASSISTANT_TOOLS,
      callModel: makeCallModel(system),
      runTool,
      maxTurns: 6,
    });
  } catch (e) {
    console.error("[office-assistant] loop failed", e);
    return { kind: "error", text: lang === "hi" ? "अभी उत्तर नहीं बन पाया। थोड़ी देर बाद फिर कोशिश करें।" : "I could not complete that just now. Please try again in a moment." };
  }

  await logUsage(outcome.usages, model());

  if (outcome.stoppedBy === "refusal") {
    return { kind: "error", text: lang === "hi" ? "यह अनुरोध पूरा नहीं किया जा सकता।" : "I can't help with that request." };
  }

  if (pending.file) {
    return { kind: "file", caption: pending.file.caption || outcome.finalText || "Report", fileBase64: pending.file.fileBase64, mime: pending.file.mime, filename: pending.file.filename };
  }
  if (pending.draft) {
    return { kind: "draft", draft: pending.draft.draft, summary: outcome.finalText || pending.draft.summary };
  }
  if (pending.ranAction) {
    return { kind: "action_done", text: outcome.finalText || "Done." };
  }
  const answer = outcome.finalText || (lang === "hi" ? "क्षमा करें, मैं समझ नहीं पाया। कृपया दोबारा पूछें।" : "Sorry, I didn't catch that. Please ask again.");
  return { kind: "answer", text: answer };
}
