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
import { loadServerMasters } from "@/lib/api/v1/auth";
import { type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { householdCandidateNumbers } from "@/lib/waHouseholdNumbers";
import { deliveryLaddersFor, ladderStage } from "@/lib/waDeliveryStatus.server";
import { loadWaCostRates } from "@/lib/waCostRates.server";
import { loadWaTemplatesServer } from "@/lib/waTemplatesRead.server";
import {
  istMonthKey,
  splitWaUsageByAudience,
  summariseAiUsage,
  summariseWaUsage,
  summariseWaUsageByMonth,
  summariseWaUsageByStudent,
  type WaAiCall,
  type WaBillCategory,
  type WaCostRates,
  type WaUsageAttributedMessage,
  type WaUsageAudience,
  type WaUsageAudienceMessage,
  type WaUsageAudienceSection,
  type WaUsageByStudent,
  type WaUsageMessage,
  type WaUsageMonth,
  type WaUsageStudentRef,
  type WaUsageSummary,
} from "@/lib/waUsageCost";

const MAX_ROWS = 5000;
const YEAR_MONTHS = 12;

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
   * The same money, split parents / staff / neither — each with its own
   * cost-per-message-type breakdown.
   */
  byAudience: WaUsageAudienceSection[];
  /** Active staff numbers the classifier had to work with. 0 = it could not. */
  staffNumbersKnown: number;
  /**
   * The last twelve IST calendar months, whatever window is selected — a
   * school budgets a year, and the fee-installment spikes only show here.
   */
  byMonth: WaUsageMonth[];
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
  /** Every number an active staff member is on file with. */
  staffNumbers: Set<string>;
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
    staffNumbers: new Set(),
    ok: false,
  };
  let sis: SisState;
  let masters: MastersState;
  try {
    // Masters comes from loadServerMasters, not the browser mirror: the
    // mirror's masters carries no staff (staff live in sis_staff, pulled
    // separately), and a staff list that is silently empty would file every
    // duty notice under "neither". This is the same source the staff
    // audience picker resolves against, so the split and the send agree.
    const [mirror, serverMasters] = await Promise.all([
      ensureSchoolMirrorHydrated()
        .then(() => getSchoolMirrorSync())
        .catch(() => null),
      loadServerMasters(),
    ]);
    sis = ((mirror?.sis as SisState | null) ?? null) || loadSis();
    masters = serverMasters;
  } catch (e) {
    console.warn(
      "[waUsage] roster unreadable",
      e instanceof Error ? e.message : e,
    );
    return empty;
  }

  // Staff numbers are read even when the student roster is empty: the
  // parents/staff split is useful on its own, and a school mid-setup may
  // have staff on file before students.
  const staffNumbers = new Set<string>();
  for (const st of masters.staff ?? []) {
    if (st.status !== "active") continue;
    for (const raw of [st.mobile, st.altMobile]) {
      const ten = last10(String(raw || ""));
      if (ten.length === 10 && /^[6-9]/.test(ten)) staffNumbers.add(ten);
    }
  }

  const students = (sis.students ?? []).filter((s) => s.status === "active");
  if (students.length === 0) return { ...empty, staffNumbers };

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

  return {
    roster,
    studentsOfHousehold,
    householdOfNumber,
    staffNumbers,
    ok: true,
  };
}

/** The first instant of the IST month `n` months back. */
function monthsAgoIso(n: number): string {
  const ist = new Date(Date.now() + 330 * 60_000);
  const start = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - n, 1) - 330 * 60_000;
  return new Date(start).toISOString();
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
      byAudience: [],
      staffNumbersKnown: 0,
      byMonth: [],
      rosterOk: false,
      attributedByNumber: 0,
    };
  }

  // One read covers both the selected window and the year series: the year
  // is a superset, and the rows come newest-first, so a read that hits its
  // cap loses only the oldest months — the window figures stay exact.
  const yearFloor = monthsAgoIso(YEAR_MONTHS - 1);
  const readFloor = sinceIso < yearFloor ? sinceIso : yearFloor;

  const { data, error } = await ctx.sb
    .from("household_message_log")
    .select("created_at, purpose, via, template_name, status, wa_message_id, household_id, mobile_e164")
    .eq("tenant_id", ctx.tenantId)
    .eq("channel", "wa")
    .eq("direction", "out")
    .gte("created_at", readFloor)
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
      byAudience: [],
      staffNumbersKnown: 0,
      byMonth: [],
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

  const truncated = rows.length >= MAX_ROWS;
  let uncategorised = 0;
  let attributedByNumber = 0;
  const attributed: WaUsageAttributedMessage[] = [];
  const byAudience: WaUsageAudienceMessage[] = [];
  const yearMessages: WaUsageMessage[] = [];
  const messages: WaUsageMessage[] = [];
  for (const r of rows) {
    const templateName = String(r.template_name || "").trim();
    const isTemplate = String(r.via || "") === "template" || !!templateName;
    let category: WaBillCategory = "service";
    if (isTemplate) {
      category = map.get(templateName.toLowerCase()) ?? "unknown";
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
    const mobile10 = last10(String(r.mobile_e164 || ""));
    let householdId = String(r.household_id || "").trim();
    let audience: WaUsageAudience = householdId ? "parents" : "other";
    let attributedByNumberRow = false;
    if (!householdId) {
      // Staff before the number-owner fallback, and after an explicit
      // household: a staff member who is also a parent at the school gets
      // counted as a parent only when dispatch was writing to them as one.
      if (attribution.staffNumbers.has(mobile10)) {
        audience = "staff";
      } else {
        const owner = attribution.householdOfNumber.get(mobile10);
        if (owner) {
          householdId = owner;
          audience = "parents";
          attributedByNumberRow = true;
        } else if (String(r.purpose || "") === "staff_message") {
          // The staff panel's own purpose, for a number not on file — a new
          // teacher whose record is not in yet.
          audience = "staff";
        }
      }
    }
    const at = String(r.created_at || "");
    const message: WaUsageMessage = {
      at,
      category,
      templateName,
      purpose: String(r.purpose || ""),
      outcome,
    };
    yearMessages.push(message);

    // Everything below the year series is about the SELECTED window only,
    // so the tables and the headline always describe the same set.
    if (at < sinceIso) continue;
    messages.push(message);
    byAudience.push({ ...message, audience });
    attributed.push({
      category,
      outcome,
      studentIds: householdId
        ? (attribution.studentsOfHousehold.get(householdId) ?? [])
        : [],
    });
    if (category === "unknown") uncategorised++;
    if (attributedByNumberRow) attributedByNumber++;
  }

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
    truncated,
    byStudent: summariseWaUsageByStudent(attributed, rates, attribution.roster),
    byAudience: splitWaUsageByAudience(byAudience, rates),
    staffNumbersKnown: attribution.staffNumbers.size,
    byMonth: summariseWaUsageByMonth(yearMessages, rates, {
      fromMonth: istMonthKey(yearFloor),
      toMonth: istMonthKey(new Date().toISOString()),
      // Hit the cap? The oldest month reached is a floor, not a total.
      partialFrom: truncated
        ? istMonthKey(String(rows[rows.length - 1]?.created_at || ""))
        : undefined,
    }),
    rosterOk: attribution.ok,
    attributedByNumber,
  };
}
