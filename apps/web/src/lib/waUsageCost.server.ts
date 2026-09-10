/**
 * The WhatsApp bill, assembled from what the school actually sent.
 *
 * Three sources, joined:
 *   household_message_log — every send the ERP made, with its template name
 *   wa_message_delivery   — Meta's sent/delivered/read/failed reports
 *   ai_generations        — the model calls behind study help
 *
 * The delivery log is also the honest denominator: it carries a row for
 * every outbound message the number sent, including the bot's own replies
 * inside an open conversation, which never touch household_message_log.
 * Those replies are free service messages today, so they change the volume
 * figure and not the money one — but a dashboard that showed 22 messages
 * when the number sent 214 would be quietly wrong about what this school
 * uses WhatsApp for.
 */

import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { getSchoolMirrorSync } from "@/lib/schoolDataMirror";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { householdCandidateNumbers } from "@/lib/waHouseholdNumbers";
import { deliveryLaddersFor, ladderStage } from "@/lib/waDeliveryStatus.server";
import { loadWaCostRates } from "@/lib/waCostRates.server";
import { loadWaTemplatesServer } from "@/lib/waTemplatesRead.server";
import {
  summariseAiUsage,
  summariseWaUsage,
  summariseWaUsageByStudent,
  type WaAiCall,
  type WaBillCategory,
  type WaCostRates,
  type WaUsageAttributedMessage,
  type WaUsageByStudent,
  type WaUsageMessage,
  type WaUsageStudentRef,
  type WaUsageSummary,
} from "@/lib/waUsageCost";

const MAX_ROWS = 5000;

function emptyByStudent(): WaUsageByStudent {
  return {
    classes: [],
    students: [],
    unattributed: { messages: 0, delivered: 0, costPaise: 0, sharesByCategory: {} },
  };
}
const DEFAULT_WINDOW_DAYS = 30;

export type WaUsageReport = {
  ok: boolean;
  error?: string;
  sinceIso: string;
  windowDays: number;
  rates: WaCostRates;
  summary: WaUsageSummary;
  /** Distinct outbound messages Meta reported on — bot replies included. */
  metaOutboundMessages: number;
  /** Template sends whose template is not in the ERP's catalogue. */
  uncategorised: number;
  /**
   * false = the template catalogue could not be read, so every template
   * fell into "unknown" and is priced at the dearest rate. The screen says
   * so rather than presenting an inflated number as fact.
   */
  catalogueOk: boolean;
  /** true = the log hit the row cap, so the window is partial. */
  truncated: boolean;
  /** The same money, per class and per child. */
  byStudent: WaUsageByStudent;
  /**
   * false = the roster could not be read, so nothing could be attributed.
   * The per-class tables say so rather than showing an empty school.
   */
  rosterOk: boolean;
  /**
   * Sends attributed only because one family owns the number — the log row
   * had no household on it. Worth showing: it is the weakest link in the
   * per-class figures.
   */
  attributedByNumber: number;
};

/**
 * Who a message was about.
 *
 * The log row names a household, not a child, and a household is one to
 * several children. So:
 *   - household on the row  → that family's currently enrolled children
 *   - no household          → the number, but ONLY if exactly one family
 *     owns it. This school has a placeholder number shared by eight
 *     families; charging one reminder to all eight families' children
 *     would invent cost across half the school.
 */
type Attribution = {
  roster: Record<string, WaUsageStudentRef>;
  studentsOfHousehold: Map<string, string[]>;
  householdOfNumber: Map<string, string | null>;
  ok: boolean;
};

function classLabel(masters: MastersState, classId: string, sectionId: string): string {
  const c = masters.classes?.find((x) => x.id === classId);
  const sec = masters.sections?.find((x) => x.id === sectionId);
  if (!c?.name) return "";
  return [`Class ${c.name}`, sec?.name || ""].filter(Boolean).join(" · ");
}

async function buildAttribution(): Promise<Attribution> {
  const empty: Attribution = {
    roster: {},
    studentsOfHousehold: new Map(),
    householdOfNumber: new Map(),
    ok: false,
  };
  let sis: SisState;
  let masters: MastersState;
  try {
    await ensureSchoolMirrorHydrated();
    const m = getSchoolMirrorSync();
    sis = (m.sis as SisState | null) || loadSis();
    masters = (m.masters as MastersState | null) || loadMasters();
  } catch (e) {
    console.warn(
      "[waUsage] roster unreadable",
      e instanceof Error ? e.message : e,
    );
    return empty;
  }

  const students = (sis.students ?? []).filter((s) => s.status === "active");
  if (students.length === 0) return empty;

  const roster: Record<string, WaUsageStudentRef> = {};
  const studentsOfHousehold = new Map<string, string[]>();
  for (const s of students) {
    roster[s.id] = {
      id: s.id,
      name: s.fullName,
      admissionNo: s.admissionNo,
      classId: s.classId,
      className: classLabel(masters, s.classId, s.sectionId),
    };
    const hh = s.householdId;
    if (!hh) continue;
    const list = studentsOfHousehold.get(hh);
    if (list) list.push(s.id);
    else studentsOfHousehold.set(hh, [s.id]);
  }

  // Reverse index over every number a family can be reached on — the same
  // candidate list the sender uses, so attribution and sending agree about
  // whose number this is. null marks a number more than one family claims.
  const householdOfNumber = new Map<string, string | null>();
  for (const hh of sis.households ?? []) {
    const cands = householdCandidateNumbers({
      household: hh,
      students: students.filter((s) => s.householdId === hh.id),
    });
    for (const c of cands) {
      if (!householdOfNumber.has(c.mobile10)) householdOfNumber.set(c.mobile10, hh.id);
      else if (householdOfNumber.get(c.mobile10) !== hh.id) {
        householdOfNumber.set(c.mobile10, null);
      }
    }
  }

  return { roster, studentsOfHousehold, householdOfNumber, ok: true };
}

/** 919876543210 / 09876543210 → 9876543210. */
function last10(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

function normalizeCategory(raw: string): WaBillCategory {
  switch ((raw || "").toUpperCase()) {
    case "MARKETING":
      return "marketing";
    case "UTILITY":
      return "utility";
    case "AUTHENTICATION":
      return "authentication";
    default:
      return "unknown";
  }
}

/**
 * Meta template name → category.
 *
 * Keyed on every name a log row might carry — the Meta name, the display
 * name and the family key — because dispatch has written all three over the
 * life of the log, and an unmatched row gets priced at the marketing rate.
 */
async function templateCategoryMap(): Promise<{
  map: Map<string, WaBillCategory>;
  ok: boolean;
}> {
  const map = new Map<string, WaBillCategory>();
  try {
    const state = await loadWaTemplatesServer();
    for (const t of state.templates) {
      const cat = normalizeCategory(t.category);
      for (const key of [t.metaName, t.name, t.familyKey]) {
        const k = String(key || "").trim().toLowerCase();
        if (k) map.set(k, cat);
      }
    }
    return { map, ok: true };
  } catch (e) {
    console.warn(
      "[waUsage] template catalogue unreadable",
      e instanceof Error ? e.message : e,
    );
    return { map, ok: false };
  }
}

async function loadAiCalls(sinceIso: string): Promise<WaAiCall[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data, error } = await ctx.sb
    .from("ai_generations")
    .select("created_at, model, prompt_tokens, completion_tokens")
    .eq("tenant_id", ctx.tenantId)
    .eq("route", "tutor")
    .eq("status", "ok")
    .gte("created_at", sinceIso)
    .limit(MAX_ROWS);
  if (error) {
    console.warn("[waUsage] ai_generations read failed", error.message);
    return [];
  }
  return (data || []).map((r) => ({
    at: String(r.created_at || ""),
    model: String(r.model || "unknown"),
    promptTokens: Number(r.prompt_tokens || 0),
    completionTokens: Number(r.completion_tokens || 0),
  }));
}

async function countMetaOutbound(sinceIso: string): Promise<number> {
  const ctx = await getServerTenantContext();
  if (!ctx) return 0;
  const { data, error } = await ctx.sb
    .from("wa_message_delivery")
    .select("wa_message_id")
    .eq("tenant_id", ctx.tenantId)
    .gte("event_at", sinceIso)
    .limit(20_000);
  if (error) {
    console.warn("[waUsage] delivery count failed", error.message);
    return 0;
  }
  return new Set((data || []).map((r) => String(r.wa_message_id || ""))).size;
}

export async function waUsageReport(
  opts: { sinceIso?: string; ratesOverride?: WaCostRates } = {},
): Promise<WaUsageReport> {
  const sinceIso =
    opts.sinceIso ||
    new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString();
  const windowDays = Math.max(
    1,
    Math.round((Date.now() - new Date(sinceIso).getTime()) / 86_400_000),
  );
  const rates = opts.ratesOverride ?? (await loadWaCostRates());

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return {
      ok: false,
      error: "Tenant not configured",
      sinceIso,
      windowDays,
      rates,
      summary: summariseWaUsage([], rates),
      metaOutboundMessages: 0,
      uncategorised: 0,
      catalogueOk: false,
      truncated: false,
      byStudent: emptyByStudent(),
      rosterOk: false,
      attributedByNumber: 0,
    };
  }

  const { data, error } = await ctx.sb
    .from("household_message_log")
    .select("created_at, purpose, via, template_name, status, wa_message_id, household_id, mobile_e164")
    .eq("tenant_id", ctx.tenantId)
    .eq("channel", "wa")
    .eq("direction", "out")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    // A failed read is not a ₹0 bill. Showing zero would tell the director
    // WhatsApp is free this month.
    return {
      ok: false,
      error: error.message,
      sinceIso,
      windowDays,
      rates,
      summary: summariseWaUsage([], rates),
      metaOutboundMessages: 0,
      uncategorised: 0,
      catalogueOk: false,
      truncated: false,
      byStudent: emptyByStudent(),
      rosterOk: false,
      attributedByNumber: 0,
    };
  }

  const rows = data || [];
  const [
    { map, ok: catalogueOk },
    ladders,
    aiCalls,
    metaOutboundMessages,
    attribution,
  ] = await Promise.all([
    templateCategoryMap(),
    deliveryLaddersFor(rows.map((r) => String(r.wa_message_id || ""))),
    loadAiCalls(sinceIso),
    countMetaOutbound(sinceIso),
    buildAttribution(),
  ]);

  let uncategorised = 0;
  let attributedByNumber = 0;
  const attributed: WaUsageAttributedMessage[] = [];
  const messages: WaUsageMessage[] = rows.map((r) => {
    const templateName = String(r.template_name || "").trim();
    const isTemplate = String(r.via || "") === "template" || !!templateName;
    let category: WaBillCategory = "service";
    if (isTemplate) {
      category = map.get(templateName.toLowerCase()) ?? "unknown";
      if (category === "unknown") uncategorised++;
    }

    const handoffFailed = String(r.status || "") === "failed";
    const stage = ladderStage(ladders.get(String(r.wa_message_id || "")));
    const outcome: WaUsageMessage["outcome"] = handoffFailed
      ? "failed"
      : stage === "failed"
        ? "failed"
        : stage === "delivered" || stage === "read"
          ? "delivered"
          : "pending";

    // Who was this about? The household on the row, or — when the row has
    // none — the number, but only where exactly one family owns it.
    let householdId = String(r.household_id || "").trim();
    if (!householdId) {
      const owner = attribution.householdOfNumber.get(
        last10(String(r.mobile_e164 || "")),
      );
      if (owner) {
        householdId = owner;
        attributedByNumber++;
      }
    }
    attributed.push({
      category,
      outcome,
      studentIds: householdId
        ? (attribution.studentsOfHousehold.get(householdId) ?? [])
        : [],
    });

    return {
      at: String(r.created_at || ""),
      category,
      templateName,
      purpose: String(r.purpose || ""),
      outcome,
    };
  });

  const ai = summariseAiUsage(aiCalls, rates);

  return {
    ok: true,
    sinceIso,
    windowDays,
    rates,
    summary: summariseWaUsage(messages, rates, ai),
    metaOutboundMessages,
    uncategorised,
    catalogueOk,
    truncated: rows.length >= MAX_ROWS,
    byStudent: summariseWaUsageByStudent(attributed, rates, attribution.roster),
    rosterOk: attribution.ok,
    attributedByNumber,
  };
}
