/**
 * What the school's WhatsApp actually costs — counted, then priced.
 *
 * Two deliberate choices, because a wrong number here is worse than no
 * number at all:
 *
 * 1. **Nothing about Meta's price list is hardcoded as fact.** Rates differ
 *    by country, by account, by the deal the BSP gave the school, and Meta
 *    has changed them twice in the life of this ERP. The figures below are
 *    STARTING VALUES the office is expected to replace with its own rate
 *    card; every screen that shows money from them says "estimate at your
 *    rates" and shows when they were last set.
 *
 * 2. **Only delivered template messages are charged.** That is how Meta
 *    bills since July 2025 — per template message delivered, by category,
 *    with service (free-form, inside the 24-hour window) messages free. A
 *    template that failed costs nothing, so counting sends would overstate
 *    the bill; a template handed over but not yet confirmed is held in a
 *    separate "could still be charged" figure rather than quietly added.
 *
 * The counting half lives here, pure, so a selftest can prove the arithmetic
 * without a database and the dashboard can re-price a window in the browser
 * when the office edits a rate.
 */

export type WaBillCategory =
  | "marketing"
  | "utility"
  | "authentication"
  | "service"
  | "unknown";

export const WA_BILL_CATEGORIES: WaBillCategory[] = [
  "marketing",
  "utility",
  "authentication",
  "service",
  "unknown",
];

export function billCategoryLabel(c: WaBillCategory): string {
  switch (c) {
    case "marketing":
      return "Marketing";
    case "utility":
      return "Utility";
    case "authentication":
      return "Authentication";
    case "service":
      return "Service (free-form reply)";
    default:
      return "Not in the template list";
  }
}

/**
 * Rates in PAISE per message, decimals allowed.
 *
 * Money elsewhere in the ERP is whole paise, but a rate is not money — a
 * utility message at ₹0.1146 is 11.46 paise, and rounding that to 11 is a
 * 4% error on the school's largest message category. Totals are rounded to
 * whole paise once, at the end.
 */
export type WaCostRates = {
  marketing: number;
  utility: number;
  authentication: number;
  /** Free today. Editable because it has not always been, and may not stay. */
  service: number;
  /** Paise per 1,000 tokens for study-help AI. */
  aiInputPerKTok: number;
  aiOutputPerKTok: number;
  /** When the office last set these, and who. Blank = still the defaults. */
  updatedAt: string;
  updatedBy: string;
  /** The office's own note, e.g. "Meta rate card 1 Sep 2026". */
  note: string;
};

/**
 * Starting figures only — India, published list rates at the time of
 * writing. The office must confirm them against its own invoice; the
 * dashboard nags until it has.
 */
export const DEFAULT_WA_RATES: WaCostRates = {
  marketing: 78.46,
  utility: 11.46,
  authentication: 12.5,
  service: 0,
  aiInputPerKTok: 1.3,
  aiOutputPerKTok: 5.2,
  updatedAt: "",
  updatedBy: "",
  note: "",
};

function rateNum(v: unknown, dflt: number): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return dflt;
  // A rate above ₹100 a message is a typo (a stray zero), not a price.
  return Math.min(n, 10_000);
}

export function normalizeWaRates(raw: unknown): WaCostRates {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    marketing: rateNum(r.marketing, DEFAULT_WA_RATES.marketing),
    utility: rateNum(r.utility, DEFAULT_WA_RATES.utility),
    authentication: rateNum(r.authentication, DEFAULT_WA_RATES.authentication),
    service: rateNum(r.service, DEFAULT_WA_RATES.service),
    aiInputPerKTok: rateNum(r.aiInputPerKTok, DEFAULT_WA_RATES.aiInputPerKTok),
    aiOutputPerKTok: rateNum(r.aiOutputPerKTok, DEFAULT_WA_RATES.aiOutputPerKTok),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
    updatedBy: typeof r.updatedBy === "string" ? String(r.updatedBy).slice(0, 120) : "",
    note: typeof r.note === "string" ? String(r.note).slice(0, 200) : "",
  };
}

/** Has anyone confirmed these against a real invoice? */
export function ratesAreDefaults(r: WaCostRates): boolean {
  return !r.updatedAt;
}

/**
 * The rate for one category.
 *
 * A template the ERP does not recognise is priced at the MARKETING rate —
 * the dearest one. An estimate that flatters the school is the one that
 * gets believed and then contradicted by the invoice.
 */
export function rateFor(rates: WaCostRates, c: WaBillCategory): number {
  switch (c) {
    case "marketing":
      return rates.marketing;
    case "utility":
      return rates.utility;
    case "authentication":
      return rates.authentication;
    case "service":
      return rates.service;
    default:
      return rates.marketing;
  }
}

/** One outbound message, already joined to its delivery ladder. */
export type WaUsageMessage = {
  at: string;
  category: WaBillCategory;
  /** Meta template name, or "" for a free-form reply. */
  templateName: string;
  purpose: string;
  /**
   * delivered — Meta confirmed it landed (or was read): charged.
   * failed    — never landed: not charged.
   * pending   — handed over, no report back yet: not charged, but might be.
   */
  outcome: "delivered" | "failed" | "pending";
};

export type WaUsageBucket = {
  category: WaBillCategory;
  label: string;
  sent: number;
  delivered: number;
  pending: number;
  failed: number;
  ratePaise: number;
  costPaise: number;
  /** What the pending ones would add if they all land. */
  pendingPaise: number;
};

export type WaUsageTemplateRow = {
  templateName: string;
  category: WaBillCategory;
  sent: number;
  delivered: number;
  failed: number;
  costPaise: number;
};

export type WaUsageDay = {
  day: string;
  delivered: number;
  failed: number;
  costPaise: number;
  /**
   * Delivered messages split by category, so a day's cost can be recomputed
   * exactly when the office edits a rate — without going back to the log.
   */
  deliveredByCategory: Partial<Record<WaBillCategory, number>>;
};

export type WaAiModelRow = {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costPaise: number;
};

export type WaAiUsage = {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costPaise: number;
  byModel: WaAiModelRow[];
};

export type WaUsageSummary = {
  buckets: WaUsageBucket[];
  templates: WaUsageTemplateRow[];
  days: WaUsageDay[];
  /** Template messages only — the billable kind. */
  templateSent: number;
  templateDelivered: number;
  templateFailed: number;
  templatePending: number;
  serviceSent: number;
  messageCostPaise: number;
  pendingCostPaise: number;
  ai: WaAiUsage;
  totalPaise: number;
};

export function emptyAiUsage(): WaAiUsage {
  return { calls: 0, promptTokens: 0, completionTokens: 0, costPaise: 0, byModel: [] };
}

/** IST calendar day of an instant — the school's day, not UTC's. */
export function istDayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 10);
}

export type WaAiCall = {
  at: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
};

export function summariseAiUsage(calls: WaAiCall[], rates: WaCostRates): WaAiUsage {
  const byModel = new Map<string, WaAiModelRow>();
  const out = emptyAiUsage();
  for (const c of calls) {
    const model = c.model || "unknown";
    const pt = Math.max(0, Math.round(c.promptTokens || 0));
    const ct = Math.max(0, Math.round(c.completionTokens || 0));
    const cost =
      (pt / 1000) * rates.aiInputPerKTok + (ct / 1000) * rates.aiOutputPerKTok;
    let row = byModel.get(model);
    if (!row) {
      row = { model, calls: 0, promptTokens: 0, completionTokens: 0, costPaise: 0 };
      byModel.set(model, row);
    }
    row.calls++;
    row.promptTokens += pt;
    row.completionTokens += ct;
    row.costPaise += cost;
    out.calls++;
    out.promptTokens += pt;
    out.completionTokens += ct;
    out.costPaise += cost;
  }
  out.costPaise = Math.round(out.costPaise);
  return {
    ...out,
    byModel: [...byModel.values()]
      .map((r) => ({ ...r, costPaise: Math.round(r.costPaise) }))
      .sort((a, b) => b.costPaise - a.costPaise || b.calls - a.calls),
  };
}

export function summariseWaUsage(
  messages: WaUsageMessage[],
  rates: WaCostRates,
  ai: WaAiUsage = emptyAiUsage(),
): WaUsageSummary {
  const buckets = new Map<WaBillCategory, WaUsageBucket>();
  for (const c of WA_BILL_CATEGORIES) {
    buckets.set(c, {
      category: c,
      label: billCategoryLabel(c),
      sent: 0,
      delivered: 0,
      pending: 0,
      failed: 0,
      ratePaise: rateFor(rates, c),
      costPaise: 0,
      pendingPaise: 0,
    });
  }
  const templates = new Map<string, WaUsageTemplateRow>();
  const days = new Map<string, WaUsageDay>();

  for (const m of messages) {
    const bucket = buckets.get(m.category) ?? buckets.get("unknown")!;
    bucket.sent++;
    if (m.outcome === "delivered") bucket.delivered++;
    else if (m.outcome === "failed") bucket.failed++;
    else bucket.pending++;

    const rate = bucket.ratePaise;
    // Delivered is the charged event. Pending is quoted separately so the
    // headline figure never claims money Meta has not billed.
    const charged = m.outcome === "delivered" ? rate : 0;
    const maybe = m.outcome === "pending" ? rate : 0;
    bucket.costPaise += charged;
    bucket.pendingPaise += maybe;

    const dayKey = istDayKey(m.at);
    if (dayKey) {
      let d = days.get(dayKey);
      if (!d) {
        d = {
          day: dayKey,
          delivered: 0,
          failed: 0,
          costPaise: 0,
          deliveredByCategory: {},
        };
        days.set(dayKey, d);
      }
      if (m.outcome === "delivered") {
        d.delivered++;
        d.deliveredByCategory[m.category] =
          (d.deliveredByCategory[m.category] ?? 0) + 1;
      }
      if (m.outcome === "failed") d.failed++;
      d.costPaise += charged;
    }

    if (m.category === "service") continue;
    const key = m.templateName || "(unnamed template)";
    let t = templates.get(key);
    if (!t) {
      t = {
        templateName: key,
        category: m.category,
        sent: 0,
        delivered: 0,
        failed: 0,
        costPaise: 0,
      };
      templates.set(key, t);
    }
    t.sent++;
    if (m.outcome === "delivered") t.delivered++;
    if (m.outcome === "failed") t.failed++;
    t.costPaise += charged;
  }

  const bucketList = [...buckets.values()]
    .map((b) => ({
      ...b,
      costPaise: Math.round(b.costPaise),
      pendingPaise: Math.round(b.pendingPaise),
    }))
    .filter((b) => b.sent > 0);

  let templateSent = 0;
  let templateDelivered = 0;
  let templateFailed = 0;
  let templatePending = 0;
  let serviceSent = 0;
  let messageCostPaise = 0;
  let pendingCostPaise = 0;
  for (const b of bucketList) {
    messageCostPaise += b.costPaise;
    pendingCostPaise += b.pendingPaise;
    if (b.category === "service") {
      serviceSent += b.sent;
      continue;
    }
    templateSent += b.sent;
    templateDelivered += b.delivered;
    templateFailed += b.failed;
    templatePending += b.pending;
  }

  return {
    buckets: bucketList.sort((a, b) => b.costPaise - a.costPaise || b.sent - a.sent),
    templates: [...templates.values()]
      .map((t) => ({ ...t, costPaise: Math.round(t.costPaise) }))
      .sort((a, b) => b.costPaise - a.costPaise || b.sent - a.sent),
    days: [...days.values()]
      .map((d) => ({ ...d, costPaise: Math.round(d.costPaise) }))
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)),
    templateSent,
    templateDelivered,
    templateFailed,
    templatePending,
    serviceSent,
    messageCostPaise,
    pendingCostPaise,
    ai,
    totalPaise: messageCostPaise + ai.costPaise,
  };
}

/**
 * The same window, priced at different rates.
 *
 * Every count needed is already in the summary — buckets carry their
 * category, template rows carry theirs, and each day carries its delivered
 * messages split by category — so a rate change re-prices exactly, with no
 * second read of the log. This is what lets the rate-card editor show the
 * effect of a number as it is typed, instead of after saving it.
 */
export function repriceWaUsage(
  summary: WaUsageSummary,
  rates: WaCostRates,
): WaUsageSummary {
  const buckets = summary.buckets.map((b) => {
    const ratePaise = rateFor(rates, b.category);
    return {
      ...b,
      ratePaise,
      costPaise: Math.round(b.delivered * ratePaise),
      pendingPaise: Math.round(b.pending * ratePaise),
    };
  });

  let messageCostPaise = 0;
  let pendingCostPaise = 0;
  for (const b of buckets) {
    messageCostPaise += b.costPaise;
    pendingCostPaise += b.pendingPaise;
  }

  const ai: WaAiUsage = {
    ...summary.ai,
    costPaise: Math.round(
      (summary.ai.promptTokens / 1000) * rates.aiInputPerKTok +
        (summary.ai.completionTokens / 1000) * rates.aiOutputPerKTok,
    ),
    byModel: summary.ai.byModel.map((m) => ({
      ...m,
      costPaise: Math.round(
        (m.promptTokens / 1000) * rates.aiInputPerKTok +
          (m.completionTokens / 1000) * rates.aiOutputPerKTok,
      ),
    })),
  };

  return {
    ...summary,
    buckets: buckets.sort((a, b) => b.costPaise - a.costPaise || b.sent - a.sent),
    templates: summary.templates
      .map((t) => ({
        ...t,
        costPaise: Math.round(t.delivered * rateFor(rates, t.category)),
      }))
      .sort((a, b) => b.costPaise - a.costPaise || b.sent - a.sent),
    days: summary.days.map((d) => {
      let cost = 0;
      for (const [cat, n] of Object.entries(d.deliveredByCategory)) {
        cost += (n ?? 0) * rateFor(rates, cat as WaBillCategory);
      }
      return { ...d, costPaise: Math.round(cost) };
    }),
    messageCostPaise,
    pendingCostPaise,
    ai,
    totalPaise: messageCostPaise + ai.costPaise,
  };
}

/** 12346 → "₹123.46" — the office reads rupees, not paise. */
export function rupees(paise: number): string {
  const n = Math.round(paise) / 100;
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** A rate is sub-paise, so it gets four decimals, not two. */
export function rateRupees(paise: number): string {
  return (paise / 100).toFixed(4);
}

/**
 * A month's bill at this window's rate of spend, so the office can see
 * where the year is heading before the invoice does.
 */
export function projectedMonthlyPaise(
  totalPaise: number,
  windowDays: number,
): number {
  if (windowDays <= 0) return 0;
  return Math.round((totalPaise / windowDays) * 30);
}
