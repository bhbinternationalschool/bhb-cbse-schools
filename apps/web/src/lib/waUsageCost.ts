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

/**
 * The per-class and per-child tables at different rates.
 *
 * Exact, not scaled: every row carries its own fractional share of
 * delivered messages by category, so re-pricing is the same multiplication
 * the first pass did. That is what lets the rate-card editor show these
 * tables moving as a rate is typed without a second read of the log.
 */
/**
 * Row order, fixed.
 *
 * Cost first, but ties broken by name — otherwise two rows on the same
 * figure swap places every time a rate is edited, and the reader thinks
 * something changed. Insertion order is not an order.
 */
function byClassCost(a: WaUsageClassRow, b: WaUsageClassRow): number {
  return (
    b.costPaise - a.costPaise ||
    b.messages - a.messages ||
    a.className.localeCompare(b.className) ||
    a.classId.localeCompare(b.classId)
  );
}

function byStudentCost(a: WaUsageStudentRow, b: WaUsageStudentRow): number {
  return (
    b.costPaise - a.costPaise ||
    b.messages - a.messages ||
    a.name.localeCompare(b.name) ||
    a.studentId.localeCompare(b.studentId)
  );
}

function shareCost(
  shares: Partial<Record<WaBillCategory, number>>,
  rates: WaCostRates,
): number {
  let cost = 0;
  for (const [cat, n] of Object.entries(shares)) {
    cost += (n ?? 0) * rateFor(rates, cat as WaBillCategory);
  }
  return cost;
}

export function repriceWaUsageByStudent(
  view: WaUsageByStudent,
  rates: WaCostRates,
): WaUsageByStudent {
  return {
    classes: view.classes
      .map((c) => {
        const cost = shareCost(c.sharesByCategory, rates);
        return {
          ...c,
          costPaise: Math.round(cost),
          perStudentPaise: c.students > 0 ? Math.round(cost / c.students) : 0,
        };
      })
      .sort(byClassCost),
    students: view.students
      .map((s) => ({
        ...s,
        costPaise: Math.round(shareCost(s.sharesByCategory, rates)),
      }))
      .sort(byStudentCost),
    unattributed: {
      ...view.unattributed,
      costPaise: Math.round(shareCost(view.unattributed.sharesByCategory, rates)),
    },
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

/* ------------------------------------------------------------------ *
 * Per class and per student
 *
 * "What does WhatsApp cost us?" has an obvious follow-up: for whom. The
 * hard part is not the arithmetic, it is honesty about a message that
 * belongs to more than one child.
 *
 * A fee reminder to a family with three children is ONE message and one
 * charge. Showing it as a charge against each of the three would triple
 * the school's bill on screen, and the numbers would stop adding up to the
 * total two tables above. So a message's cost is SPLIT equally between the
 * children it was about: three children, a third each. Class totals then
 * sum to the message total, and a class of many siblings is not punished
 * for being the second name on a shared reminder.
 *
 * Fractions are kept until the last step and rounded once per row, so a
 * row can differ from the sum of its parts by a paisa. That is the right
 * trade: rounding each child's share first would lose rupees on a busy
 * month.
 * ------------------------------------------------------------------ */

/** One message, with the children it is charged to. Empty = unattributed. */
export type WaUsageAttributedMessage = {
  category: WaBillCategory;
  outcome: WaUsageMessage["outcome"];
  studentIds: string[];
};

export type WaUsageStudentRef = {
  id: string;
  name: string;
  admissionNo: string;
  classId: string;
  className: string;
};

export type WaUsageStudentRow = {
  studentId: string;
  name: string;
  admissionNo: string;
  classId: string;
  className: string;
  /** Messages that were about this child (a shared one counts once here). */
  messages: number;
  delivered: number;
  /** This child's share of the cost. */
  costPaise: number;
  /**
   * The child's share of delivered messages, by category — fractional,
   * because a message about three siblings is a third of one each. Kept so
   * a rate change re-prices these tables exactly rather than by a ratio.
   */
  sharesByCategory: Partial<Record<WaBillCategory, number>>;
};

export type WaUsageClassRow = {
  classId: string;
  className: string;
  /** Children in the class who were written about at all. */
  students: number;
  messages: number;
  delivered: number;
  costPaise: number;
  /** Cost ÷ children written about — the comparable figure between classes. */
  perStudentPaise: number;
  sharesByCategory: Partial<Record<WaBillCategory, number>>;
};

export type WaUsageUnattributed = {
  messages: number;
  delivered: number;
  costPaise: number;
  sharesByCategory: Partial<Record<WaBillCategory, number>>;
};

export type WaUsageByStudent = {
  classes: WaUsageClassRow[];
  students: WaUsageStudentRow[];
  unattributed: WaUsageUnattributed;
};

export function summariseWaUsageByStudent(
  messages: WaUsageAttributedMessage[],
  rates: WaCostRates,
  roster: Record<string, WaUsageStudentRef>,
): WaUsageByStudent {
  type Acc = {
    messages: number;
    delivered: number;
    cost: number;
    shares: Partial<Record<WaBillCategory, number>>;
  };
  const perStudent = new Map<string, Acc>();
  const unattributed: WaUsageUnattributed = {
    messages: 0,
    delivered: 0,
    costPaise: 0,
    sharesByCategory: {},
  };
  let unattributedCost = 0;

  for (const m of messages) {
    const cost = m.outcome === "delivered" ? rateFor(rates, m.category) : 0;
    // A child the roster does not know cannot be shown in a class, so the
    // message is unattributed rather than charged to a name we cannot print.
    const ids = [...new Set(m.studentIds)].filter((id) => !!roster[id]);
    if (ids.length === 0) {
      unattributed.messages++;
      if (m.outcome === "delivered") {
        unattributed.delivered++;
        unattributed.sharesByCategory[m.category] =
          (unattributed.sharesByCategory[m.category] ?? 0) + 1;
      }
      unattributedCost += cost;
      continue;
    }
    const share = cost / ids.length;
    for (const id of ids) {
      let acc = perStudent.get(id);
      if (!acc) {
        acc = { messages: 0, delivered: 0, cost: 0, shares: {} };
        perStudent.set(id, acc);
      }
      acc.messages++;
      if (m.outcome === "delivered") {
        acc.delivered++;
        acc.shares[m.category] =
          (acc.shares[m.category] ?? 0) + 1 / ids.length;
      }
      acc.cost += share;
    }
  }
  unattributed.costPaise = Math.round(unattributedCost);

  const students: WaUsageStudentRow[] = [];
  const classAcc = new Map<
    string,
    {
      className: string;
      students: number;
      messages: number;
      delivered: number;
      cost: number;
      shares: Partial<Record<WaBillCategory, number>>;
    }
  >();

  for (const [id, acc] of perStudent) {
    const ref = roster[id];
    students.push({
      studentId: id,
      name: ref.name,
      admissionNo: ref.admissionNo,
      classId: ref.classId,
      className: ref.className,
      messages: acc.messages,
      delivered: acc.delivered,
      costPaise: Math.round(acc.cost),
      sharesByCategory: acc.shares,
    });
    const key = ref.classId || "";
    let c = classAcc.get(key);
    if (!c) {
      c = {
        className: ref.className || "No class on record",
        students: 0,
        messages: 0,
        delivered: 0,
        cost: 0,
        shares: {},
      };
      classAcc.set(key, c);
    }
    c.students++;
    c.messages += acc.messages;
    c.delivered += acc.delivered;
    c.cost += acc.cost;
    for (const [cat, n] of Object.entries(acc.shares)) {
      const k = cat as WaBillCategory;
      c.shares[k] = (c.shares[k] ?? 0) + (n ?? 0);
    }
  }

  const classes: WaUsageClassRow[] = [...classAcc.entries()].map(
    ([classId, c]) => ({
      classId,
      className: c.className,
      students: c.students,
      messages: c.messages,
      delivered: c.delivered,
      costPaise: Math.round(c.cost),
      perStudentPaise: c.students > 0 ? Math.round(c.cost / c.students) : 0,
      sharesByCategory: c.shares,
    }),
  );

  return {
    classes: classes.sort(byClassCost),
    students: students.sort(byStudentCost),
    unattributed,
  };
}


/* ------------------------------------------------------------------ *
 * Parents, staff, and everyone else
 *
 * Staff WhatsApp — duty changes, substitution notices, the leadership
 * broadcast — goes out through the same sender and lands in the same log
 * as a fee reminder, with no household on the row. Until now it all sat
 * inside one total, so "what are we spending on staff messaging" had no
 * answer, and the answer matters: staff messages are the ones most often
 * sent as free-form replies inside an open conversation, which cost
 * nothing, while a notice to a teacher who has not messaged this week
 * needs a paid template. Those two look identical on a phone and differ
 * by the whole price of the message.
 *
 * Each audience is summarised with the SAME function as the school-wide
 * figures, so the message types, rates and rules are identical and the
 * sections add up to the total above them.
 * ------------------------------------------------------------------ */

export type WaUsageAudience = "parents" | "staff" | "other";

/** Fixed order: the reader wants parents and staff in the same place every time. */
export const WA_USAGE_AUDIENCES: WaUsageAudience[] = ["parents", "staff", "other"];

export function audienceLabel(a: WaUsageAudience): string {
  switch (a) {
    case "parents":
      return "Parents and families";
    case "staff":
      return "Staff";
    default:
      return "Neither — number not on file";
  }
}

export function audienceHint(a: WaUsageAudience): string {
  switch (a) {
    case "parents":
      return "Fee reminders, receipts, notices — anything to a family on the roster";
    case "staff":
      return "Duty and substitution notices, staff broadcasts, anything to a staff number";
    default:
      return "A number that matches no family and no staff member — an enquiry, a vendor, a wrong entry";
  }
}

export type WaUsageAudienceMessage = WaUsageMessage & {
  audience: WaUsageAudience;
};

export type WaUsageAudienceSection = {
  audience: WaUsageAudience;
  label: string;
  hint: string;
  /** The same shape as the school-wide figures, for this audience only. */
  summary: WaUsageSummary;
};

export function splitWaUsageByAudience(
  messages: WaUsageAudienceMessage[],
  rates: WaCostRates,
): WaUsageAudienceSection[] {
  const sections: WaUsageAudienceSection[] = [];
  for (const audience of WA_USAGE_AUDIENCES) {
    const mine = messages.filter((m) => m.audience === audience);
    // An audience nobody wrote to is left out rather than shown as a row of
    // zeros — the school has no staff sends yet, and an empty Staff table
    // reads as "this is broken" where no table reads as "nothing yet".
    if (mine.length === 0) continue;
    sections.push({
      audience,
      label: audienceLabel(audience),
      hint: audienceHint(audience),
      summary: summariseWaUsage(mine, rates),
    });
  }
  return sections;
}

/** The audience sections at different rates — exact, via repriceWaUsage. */
export function repriceWaUsageByAudience(
  sections: WaUsageAudienceSection[],
  rates: WaCostRates,
): WaUsageAudienceSection[] {
  return sections.map((s) => ({
    ...s,
    summary: repriceWaUsage(s.summary, rates),
  }));
}


/* ------------------------------------------------------------------ *
 * The year, month by month
 *
 * The window chips answer "what are we spending now". A school budgets a
 * year, and the shape of a school year is not flat: fee reminders spike at
 * each installment, admissions run in one season, and a fortnight of exams
 * is nearly silent. A monthly series is the only view in which any of that
 * is visible, and the only one a budget line can be drawn from.
 *
 * Months are IST calendar months, because that is what the school's own
 * accounts are cut on. Each month carries its fractional shares by
 * category, so the whole year re-prices exactly when a rate is edited.
 * ------------------------------------------------------------------ */

export type WaUsageMonth = {
  /** "2026-09" — sortable, and the key the UI uses. */
  month: string;
  /** "Sep 2026" — what the office reads. */
  label: string;
  sent: number;
  delivered: number;
  failed: number;
  pending: number;
  costPaise: number;
  sharesByCategory: Partial<Record<WaBillCategory, number>>;
  /**
   * true = the log read did not reach the start of this month, so its
   * figure is a floor, not a total. Shown, never silently averaged in.
   */
  partial: boolean;
};

/** IST calendar month of an instant. */
export function istMonthKey(iso: string): string {
  const day = istDayKey(iso);
  return day ? day.slice(0, 7) : "";
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const idx = Number(m) - 1;
  if (!y || !(idx >= 0 && idx < 12)) return key;
  return `${MONTH_NAMES[idx]} ${y}`;
}

/** Every month from `from` to `to` inclusive, both "YYYY-MM". */
export function monthRange(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  let guard = 0;
  while ((y < ty || (y === ty && m <= tm)) && guard++ < 240) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function summariseWaUsageByMonth(
  messages: WaUsageMessage[],
  rates: WaCostRates,
  opts: {
    /** Oldest month the read covered — earlier months are simply absent. */
    fromMonth?: string;
    /** Newest month to show, normally the current one. */
    toMonth?: string;
    /** The month the read stopped inside, if it hit its row cap. */
    partialFrom?: string;
  } = {},
): WaUsageMonth[] {
  const acc = new Map<string, WaUsageMonth>();

  const blank = (month: string): WaUsageMonth => ({
    month,
    label: monthLabel(month),
    sent: 0,
    delivered: 0,
    failed: 0,
    pending: 0,
    costPaise: 0,
    sharesByCategory: {},
    partial: !!opts.partialFrom && month <= opts.partialFrom,
  });

  // Months with no sends are shown as ₹0 rather than skipped: a gap in a
  // year series reads as missing data, and "we sent nothing in May" is a
  // real and useful answer.
  for (const m of monthRange(opts.fromMonth ?? "", opts.toMonth ?? "")) {
    acc.set(m, blank(m));
  }

  for (const msg of messages) {
    const key = istMonthKey(msg.at);
    if (!key) continue;
    let row = acc.get(key);
    if (!row) {
      row = blank(key);
      acc.set(key, row);
    }
    row.sent++;
    if (msg.outcome === "delivered") {
      row.delivered++;
      row.sharesByCategory[msg.category] =
        (row.sharesByCategory[msg.category] ?? 0) + 1;
      row.costPaise += rateFor(rates, msg.category);
    } else if (msg.outcome === "failed") row.failed++;
    else row.pending++;
  }

  return [...acc.values()]
    .map((r) => ({ ...r, costPaise: Math.round(r.costPaise) }))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

export function repriceWaUsageByMonth(
  months: WaUsageMonth[],
  rates: WaCostRates,
): WaUsageMonth[] {
  return months.map((m) => ({
    ...m,
    costPaise: Math.round(shareCost(m.sharesByCategory, rates)),
  }));
}

export type WaUsageYearTotals = {
  costPaise: number;
  delivered: number;
  failed: number;
  /** Months with a complete read behind them — the ones worth averaging. */
  completeMonths: number;
  /** Average over complete months only; a partial month would drag it down. */
  averagePaise: number;
  /**
   * The unrounded cost of those complete months.
   *
   * Kept because projecting a session from `averagePaise` compounds its
   * rounding: ₹0.20 over six months rounds to 3 paise a month, and 3 × 12
   * is 36 rather than 40 — a tenth of the figure lost to a display value.
   * Anything pacing forward divides this instead.
   */
  completeCostPaise: number;
  dearest: WaUsageMonth | null;
};

export function waUsageYearTotals(months: WaUsageMonth[]): WaUsageYearTotals {
  let costPaise = 0;
  let delivered = 0;
  let failed = 0;
  let completeMonths = 0;
  let completeCost = 0;
  let dearest: WaUsageMonth | null = null;
  for (const m of months) {
    costPaise += m.costPaise;
    delivered += m.delivered;
    failed += m.failed;
    if (!m.partial) {
      completeMonths++;
      completeCost += m.costPaise;
    }
    if (!dearest || m.costPaise > dearest.costPaise) dearest = m;
  }
  return {
    costPaise,
    delivered,
    failed,
    completeMonths,
    averagePaise: completeMonths > 0 ? Math.round(completeCost / completeMonths) : 0,
    completeCostPaise: completeCost,
    dearest,
  };
}


/* ------------------------------------------------------------------ *
 * The session, not the last twelve months
 *
 * A rolling year is the wrong frame for a school. The books close on
 * 31 March, the fee structure is set per session, and "what did WhatsApp
 * cost us this year" means the session — so the monthly series runs from
 * the session's first month to its last.
 *
 * The session itself is read from Masters rather than assumed: April to
 * March is the norm in India and it is what this school runs, but it is
 * configuration, not a law, and a school on a different calendar must not
 * be shown someone else's year. April–March is only the fallback for when
 * Masters has no session defined, and the screen says when it is guessing.
 * ------------------------------------------------------------------ */

export type WaUsageYearWindow = {
  /** "2026-27" */
  code: string;
  label: string;
  /** First and last month to show — "YYYY-MM". */
  fromMonth: string;
  /** The current month, or the session's last if the session has ended. */
  toMonth: string;
  /** The session's final month, which may be in the future. */
  endMonth: string;
  /** Months in the whole session — 12 normally, for pacing to its end. */
  monthsInYear: number;
  /** Months still to come after toMonth. 0 = the session is complete. */
  monthsRemaining: number;
  /** false = April–March was assumed because Masters defines no session. */
  configured: boolean;
};

function monthOf(dateish: string): string {
  const d = (dateish || "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(d) ? d : "";
}

function clampMonth(m: string, lo: string, hi: string): string {
  if (m < lo) return lo;
  if (m > hi) return hi;
  return m;
}

/** "2026-04" + "2027-03" → "2026-27". */
function sessionCodeFor(fromMonth: string, endMonth: string): string {
  const a = fromMonth.slice(0, 4);
  const b = endMonth.slice(0, 4);
  return a === b ? a : `${a}-${b.slice(2)}`;
}

export function waUsageYearWindow(opts: {
  startsOn?: string;
  endsOn?: string;
  code?: string;
  label?: string;
  todayIso: string;
}): WaUsageYearWindow {
  const today = istMonthKey(opts.todayIso) || monthOf(opts.todayIso);
  let fromMonth = monthOf(opts.startsOn || "");
  let endMonth = monthOf(opts.endsOn || "");
  let configured = true;

  if (!fromMonth || !endMonth || fromMonth > endMonth) {
    // No session on file: assume the Indian school year, April to March,
    // the one containing today.
    configured = false;
    const [y, m] = today.split("-").map(Number);
    const startYear = m >= 4 ? y : y - 1;
    fromMonth = `${startYear}-04`;
    endMonth = `${startYear + 1}-03`;
  }

  const toMonth = clampMonth(today, fromMonth, endMonth);
  const code = opts.code || sessionCodeFor(fromMonth, endMonth);
  return {
    code,
    label: opts.label || code,
    fromMonth,
    toMonth,
    endMonth,
    monthsInYear: monthRange(fromMonth, endMonth).length,
    monthsRemaining: Math.max(0, monthRange(toMonth, endMonth).length - 1),
    configured,
  };
}

/**
 * What the whole session looks like at this pace.
 *
 * Built from the average COMPLETE month and the session's own length, so a
 * six-month-old session projects to twelve and a finished one projects to
 * exactly what it cost. Returns null when there is nothing to pace from —
 * better no figure than a projection off one week of data.
 */
export function projectedSessionPaise(
  totals: WaUsageYearTotals,
  year: WaUsageYearWindow,
): number | null {
  if (totals.completeMonths === 0) return null;
  if (year.monthsRemaining === 0) return totals.costPaise;
  return Math.round(
    (totals.completeCostPaise / totals.completeMonths) * year.monthsInYear,
  );
}
