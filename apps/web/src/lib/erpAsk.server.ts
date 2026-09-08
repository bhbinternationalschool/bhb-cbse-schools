/**
 * Ask the ERP — the tool executors and the orchestration. See erpAsk.ts for
 * the design; this file is the part that touches data and the model.
 *
 * Every tool runs under the asker's RBAC (the same hasPermission the command
 * catalogue uses). Children's names in a dues list are shown to the office
 * (owner / staff flows) and withheld from the teacher flow, which sees the
 * counts — the same line the class_defaulters command draws with sections.
 */
import "server-only";
import { buildAgeing, AGEING_BAND_LABEL, type AgeingBand } from "@/lib/collectionsWeeklyAi";
import type { DemoSession } from "@/lib/auth";
import {
  deterministicPlan,
  ERP_ASK_TOOLS,
  erpAskOutOfScopeReply,
  previousRange,
  renderAgeingFacts,
  renderClassStrengthFacts,
  renderCollectionsFacts,
  renderConcessionsFacts,
  resolvePeriodRange,
  type AgeingFacts,
  type ClassStrengthFacts,
  type CollectionsFacts,
  type ConcessionsFacts,
  type ErpAskFact,
  type ErpAskPlan,
  type ErpAskPlanTool,
  type ErpAskToolDef,
} from "@/lib/erpAsk";
import { ensureFeesHydratedServer } from "@/lib/feesPersistence.server";
import { loadFees } from "@/lib/fees";
import { classLabel } from "@/lib/homework";
import { formatInr, loadMasters, type MastersState } from "@/lib/masters";
import { hasPermission, type RbacState } from "@/lib/rbac";
import { getServerTenantContext } from "@/lib/serverTenant";
import { loadSis } from "@/lib/sis";
import { fetchAllPages } from "@/lib/supabase/pageAll";

export type ErpAskReaders = {
  /** The command desk's own attendance reading for a date, school scope. */
  attendance: (dateIso: string) => Promise<string>;
  /** The command desk's own admissions reading for a period label. */
  admissions: (periodLabel: string) => Promise<string>;
};

export type ErpAskInput = {
  text: string;
  session: DemoSession;
  masters: MastersState;
  rbac: RbacState;
  flow: "owner" | "staff" | "teacher";
  firstName: string;
  schoolName: string;
  todayIso: string;
  previous?: { question: string; answer: string } | null;
  readers: ErpAskReaders;
};

export type ErpAskOutcome = {
  text: string;
  toolsUsed: string[];
  planSource: "llm" | "keywords";
  answerSource: "llm" | "facts";
  generationIds: string[];
};

type DueRow = { student_id: string; household_id: string | null; due_on: string | null; balance_paise: number; concession_paise: number };

async function readOpenDues(ay: string): Promise<DueRow[] | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { rows, error } = await fetchAllPages<DueRow>((from, to) =>
    ctx.sb
      .from("fee_desk_open_dues")
      .select("student_id, household_id, due_on, balance_paise, concession_paise")
      .eq("tenant_id", ctx.tenantId)
      .eq("academic_year_code", ay)
      .order("student_id", { ascending: true })
      .range(from, to),
  );
  if (error) return null;
  return rows;
}

function normalizeClassRef(s: string): string {
  return s.toLowerCase().replace(/\b(class|kaksha|std|grade)\b/g, "").replace(/[^a-z0-9]/g, "");
}

function classMatches(label: string, ref: string): boolean {
  const l = normalizeClassRef(label);
  const r = normalizeClassRef(ref);
  if (!r) return true;
  // "5" matches "Class 5 A" and "Class 5 B"; "5a" matches only "Class 5 A".
  return l === r || l.startsWith(r) && /^[a-z]?$/.test(l.slice(r.length));
}

async function collections(tool: ErpAskPlanTool, session: DemoSession, todayIso: string): Promise<ErpAskFact> {
  await ensureFeesHydratedServer();
  const ay = session.academicYearCode;
  const range = resolvePeriodRange(tool.period ?? "today", todayIso);
  const prev = previousRange(range);
  const live = (loadFees().vouchers ?? []).filter((v) => !v.voidedAt && (!v.academicYearCode || v.academicYearCode === ay));
  const inRange = (r: { from: string; to: string }) => live.filter((v) => v.collectionDate >= r.from && v.collectionDate <= r.to);
  const cur = inRange(range);
  const byMode = new Map<string, number>();
  for (const v of cur) {
    for (const t of v.tenders ?? []) {
      const label = t.gatewayProvider ? "Online" : (t.mode || "other").toUpperCase();
      byMode.set(label, (byMode.get(label) ?? 0) + t.amountPaise);
    }
  }
  const sum = (vs: typeof cur) => vs.reduce((s, v) => s + v.totalPaise, 0);
  const facts: CollectionsFacts = {
    range,
    count: cur.length,
    amountPaise: sum(cur),
    previous: prev ? { range: prev, count: inRange(prev).length, amountPaise: sum(inRange(prev)) } : null,
    byMode: [...byMode.entries()].sort((a, b) => b[1] - a[1]).map(([label, amountPaise]) => ({ label, amountPaise })),
  };
  return { tool: "collections", text: renderCollectionsFacts(facts) };
}

async function duesAgeing(tool: ErpAskPlanTool, input: ErpAskInput): Promise<ErpAskFact> {
  const ay = input.session.academicYearCode;
  const rows = await readOpenDues(ay);
  if (!rows) return { tool: "dues_ageing", text: "*Dues ageing*: not available right now (the dues book could not be read)." };
  const sis = loadSis();
  const masters = input.masters;
  const studentClass = new Map(sis.students.map((s) => [s.id, { name: s.fullName, classLabel: classLabel(masters, s.classId, s.sectionId) }]));
  const scoped = tool.classRef ? rows.filter((r) => classMatches(studentClass.get(r.student_id)?.classLabel ?? "", tool.classRef!)) : rows;
  const dues = scoped.map((r) => ({ studentId: r.student_id, dueOn: r.due_on || input.todayIso, balancePaise: Number(r.balance_paise) || 0 }));
  const a = buildAgeing(dues, input.todayIso);
  const bandOrder: Exclude<AgeingBand, never>[] = ["over90", "d31to90", "d0to30", "notDue"];
  const facts: AgeingFacts = {
    scopeLabel: tool.classRef ? `class ${tool.classRef}` : "whole school",
    bands: bandOrder.map((band) => {
      const b = a.ageing.find((x) => x.band === band)!;
      return { band, label: AGEING_BAND_LABEL[band], amountPaise: b.amountPaise, children: b.children };
    }),
    totalOpenPaise: a.totalOpenPaise,
    childrenOwing: a.childrenOwing,
    listed: null,
  };
  const wantList = (tool.band && tool.band !== "all") || !!tool.classRef;
  if (wantList) {
    if (input.flow === "teacher") {
      facts.listed = null;
    } else {
      const { ageingBandFor } = await import("@/lib/collectionsWeeklyAi");
      const band = tool.band && tool.band !== "all" ? tool.band : null;
      const perStudent = new Map<string, { amountPaise: number; oldest: string }>();
      for (const d of dues) {
        if (d.balancePaise <= 0) continue;
        if (band && ageingBandFor(d.dueOn, input.todayIso) !== band) continue;
        const cur = perStudent.get(d.studentId) ?? { amountPaise: 0, oldest: d.dueOn };
        cur.amountPaise += d.balancePaise;
        if (d.dueOn < cur.oldest) cur.oldest = d.dueOn;
        perStudent.set(d.studentId, cur);
      }
      const limit = tool.limit ?? 10;
      const sorted = [...perStudent.entries()].sort((x, y) => y[1].amountPaise - x[1].amountPaise);
      facts.listed = {
        band: band ? AGEING_BAND_LABEL[band] : `Owing in ${facts.scopeLabel}`,
        rows: sorted.slice(0, limit).map(([id, v]) => ({
          name: studentClass.get(id)?.name ?? "Unknown student",
          classLabel: studentClass.get(id)?.classLabel ?? "—",
          amountPaise: v.amountPaise,
          oldestDueOn: v.oldest,
        })),
        more: Math.max(0, sorted.length - limit),
      };
    }
  }
  let text = renderAgeingFacts(facts);
  if (wantList && input.flow === "teacher") text += "\nChildren's names for a dues list are shown to the office; ask them for the list.";
  return { tool: "dues_ageing", text };
}

function classStrength(tool: ErpAskPlanTool, input: ErpAskInput): ErpAskFact {
  const sis = loadSis();
  const ay = input.session.academicYearCode;
  const active = sis.students.filter((s) => s.status === "active" && (!s.academicYearCode || s.academicYearCode === ay));
  const byLabel = new Map<string, number>();
  for (const s of active) {
    const label = classLabel(input.masters, s.classId, s.sectionId) || "Unassigned";
    if (tool.classRef && !classMatches(label, tool.classRef)) continue;
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
  }
  const rows = [...byLabel.entries()].sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true })).map(([label, count]) => ({ label, count }));
  const facts: ClassStrengthFacts = {
    scopeLabel: tool.classRef ? `class ${tool.classRef}` : "whole school",
    total: rows.reduce((s, r) => s + r.count, 0),
    rows: tool.classRef ? rows : rows.length <= 24 ? rows : [],
  };
  let text = renderClassStrengthFacts(facts);
  if (tool.classRef && !rows.length) text = `*Students · class ${tool.classRef}*: no active students found under that class name — check the spelling, e.g. _5A_ or _class 5_.`;
  return { tool: "class_strength", text };
}

async function staffToday(input: ErpAskInput): Promise<ErpAskFact> {
  const { buildPrincipalSnapshot } = await import("@/lib/principalSnapshot.server");
  const snap = await buildPrincipalSnapshot(input.session.academicYearCode);
  return {
    tool: "staff_today",
    text: `*Staff · today*\n${snap.staff.presentToday} present · ${snap.staff.absentToday} absent · ${snap.staff.activeCount} active staff`,
  };
}

async function concessions(input: ErpAskInput): Promise<ErpAskFact> {
  const masters = input.masters;
  const grants = (masters.concessionGrants ?? []).filter((g) => g.status === "approved");
  const rows = await readOpenDues(input.session.academicYearCode);
  const soon = new Date(`${input.todayIso}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 120);
  const soonIso = soon.toISOString().slice(0, 10);
  const expiring = grants.filter((g) => g.effectiveTo && g.effectiveTo >= input.todayIso && g.effectiveTo <= soonIso);
  const facts: ConcessionsFacts = {
    children: new Set(grants.map((g) => g.studentId)).size,
    grants: grants.length,
    definitions: (masters.concessions ?? []).length,
    costThisSessionPaise: rows ? rows.reduce((s, r) => s + (Number(r.concession_paise) || 0), 0) : null,
    expiringBy: expiring.length ? { date: expiring.map((g) => g.effectiveTo!).sort().pop()!, grants: expiring.length } : null,
    withoutGround: grants.filter((g) => !g.ground).length,
  };
  return { tool: "concessions", text: renderConcessionsFacts(facts) };
}

/**
 * Answer one question. Returns null when the question is not about school
 * data at all — the desk then stays quiet as it always has.
 */
export async function answerErpAsk(input: ErpAskInput): Promise<ErpAskOutcome | null> {
  const { ensureSchoolMirrorHydrated } = await import("@/lib/schoolDataMirror.server");
  await ensureSchoolMirrorHydrated();
  void loadMasters;

  const allowedTools: ErpAskToolDef[] = ERP_ASK_TOOLS.filter((t) => hasPermission(input.session, input.masters, t.module, t.action, input.rbac));
  const generationIds: string[] = [];

  // 1. Plan — the model first, keywords when it is missing or unsure.
  let plan: ErpAskPlan | null = null;
  let planSource: ErpAskOutcome["planSource"] = "keywords";
  try {
    const { generateErpAskPlanJson } = await import("@/lib/aiLlm.server");
    const r = await generateErpAskPlanJson({ text: input.text, todayIso: input.todayIso });
    if (r.ok) {
      generationIds.push(r.generationId);
      if (r.plan.confidence >= 0.5 && (r.plan.tools.length || r.plan.outOfScope)) {
        plan = r.plan;
        planSource = "llm";
      }
    }
  } catch {
    plan = null;
  }
  if (!plan) plan = deterministicPlan(input.text);
  if (!plan) return null;
  if (!plan.tools.length) {
    if (!plan.outOfScope) return null;
    return { text: erpAskOutOfScopeReply(allowedTools), toolsUsed: [], planSource, answerSource: "facts", generationIds };
  }

  // 2. Run the tools the asker may see.
  const facts: ErpAskFact[] = [];
  const notes: string[] = [];
  const used: string[] = [];
  for (const tool of plan.tools) {
    const def = ERP_ASK_TOOLS.find((t) => t.id === tool.id)!;
    if (!allowedTools.some((t) => t.id === tool.id)) {
      notes.push(`${def.id.replace("_", " ")}: not permitted for this role (${def.module} · ${def.action}).`);
      continue;
    }
    try {
      switch (tool.id) {
        case "collections":
          facts.push(await collections(tool, input.session, input.todayIso));
          break;
        case "dues_ageing":
          facts.push(await duesAgeing(tool, input));
          break;
        case "class_strength":
          facts.push(classStrength(tool, input));
          break;
        case "attendance": {
          const range = resolvePeriodRange(tool.period === "yesterday" ? "yesterday" : "today", input.todayIso);
          facts.push({ tool: "attendance", text: await input.readers.attendance(range.to) });
          break;
        }
        case "admissions": {
          const label = tool.period ? resolvePeriodRange(tool.period, input.todayIso).label.replace(" (from Monday)", "") : "this week";
          facts.push({ tool: "admissions", text: await input.readers.admissions(label) });
          break;
        }
        case "staff_today":
          facts.push(await staffToday(input));
          break;
        case "concessions":
          facts.push(await concessions(input));
          break;
      }
      used.push(tool.id);
    } catch (e) {
      notes.push(`${def.id.replace("_", " ")}: not available right now (${e instanceof Error ? e.message : "error"}).`);
    }
  }
  if (!facts.length) {
    const text = notes.length ? notes.join("\n") : erpAskOutOfScopeReply(allowedTools);
    return { text, toolsUsed: used, planSource, answerSource: "facts", generationIds };
  }

  // 3. Write — and 4. guard. The facts are the answer either way.
  const factsText = facts.map((f) => f.text).join("\n\n") + (notes.length ? `\n\n${notes.join("\n")}` : "");
  try {
    const { generateErpAskAnswerJson } = await import("@/lib/aiLlm.server");
    const r = await generateErpAskAnswerJson({
      question: input.text,
      facts,
      notes,
      factsText,
      language: plan.language,
      schoolName: input.schoolName,
      firstName: input.firstName,
      previous: input.previous ?? null,
    });
    if (r.ok) {
      generationIds.push(r.generationId);
      return { text: r.answer, toolsUsed: used, planSource, answerSource: "llm", generationIds };
    }
  } catch {
    /* fall through to the facts */
  }
  return { text: factsText, toolsUsed: used, planSource, answerSource: "facts", generationIds };
}

/** Exposed for the self-test of the class matcher; not used elsewhere. */
export const _classMatches = classMatches;
export const _formatInr = formatInr;
