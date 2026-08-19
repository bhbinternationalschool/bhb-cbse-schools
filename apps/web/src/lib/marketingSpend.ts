/**
 * Marketing spend per campaign / source (informational, typed by the
 * office) and the attribution roll-up: leads → registered → enrolled per
 * campaign id and per source, with cost per lead / per enrolment when a
 * spend is recorded. Nothing here is invented — unknown spend shows "—".
 * Persisted through module_local_state ("marketing_spend").
 */

import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import { assertModulePermission } from "@/lib/rbacGuard";
import { sourceLabel, type AdmissionLead, type AdmissionSource } from "@/lib/admissions";

export type SpendEntry = {
  id: string;
  /** Ad-platform campaign id as it appears on leads (Google campaign_id, UTM); "" = whole source */
  campaignId: string;
  /** Source the spend belongs to (google / social / website / other…) */
  source: string;
  label: string;
  /** Spend period, YYYY-MM-DD ("" = open) */
  from: string;
  to: string;
  amountPaise: number;
  note: string;
  updatedAt: string;
  updatedBy: string;
};

export type MarketingSpendState = { version: 1; entries: SpendEntry[]; updatedAt: string };

const STORAGE_KEY = "bhb_marketing_spend_v1";
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const date = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : "");

export function emptyMarketingSpend(): MarketingSpendState {
  return { version: 1, entries: [], updatedAt: "" };
}
export function normalizeMarketingSpend(raw: unknown): MarketingSpendState {
  const d = emptyMarketingSpend();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<MarketingSpendState>;
  const seen = new Set<string>();
  const entries: SpendEntry[] = [];
  for (const e of Array.isArray(r.entries) ? r.entries : []) {
    const x = (e ?? {}) as Partial<SpendEntry>;
    const id = str(x.id, 40) || `spend_${Math.random().toString(36).slice(2, 10)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const amount = Math.max(0, Math.round(Number(x.amountPaise) || 0));
    const label = str(x.label, 120);
    if (!label && !x.campaignId) continue;
    entries.push({ id, campaignId: str(x.campaignId, 80), source: str(x.source, 30), label, from: date(x.from), to: date(x.to), amountPaise: amount, note: str(x.note, 300), updatedAt: str(x.updatedAt, 40), updatedBy: str(x.updatedBy, 120) });
  }
  return { version: 1, entries, updatedAt: str(r.updatedAt, 40) };
}
export function loadMarketingSpend(): MarketingSpendState {
  if (typeof window === "undefined") return emptyMarketingSpend();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeMarketingSpend(JSON.parse(raw)) : emptyMarketingSpend();
  } catch {
    return emptyMarketingSpend();
  }
}
export function saveMarketingSpend(state: MarketingSpendState): MarketingSpendState {
  const next = normalizeMarketingSpend({ ...state, updatedAt: new Date().toISOString() });
  if (!assertModulePermission("admissions", "edit", "saveMarketingSpend")) return next;
  if (typeof window !== "undefined") {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
    void import("@/lib/localModulesPersistence").then((m) => m.scheduleModuleStateSync("marketing_spend", next));
    window.dispatchEvent(new CustomEvent("bhb-marketing-spend"));
  }
  return next;
}
export function writeMarketingSpendLocalRaw(state: MarketingSpendState): void {
  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(normalizeMarketingSpend(state)));
  } catch {
    /* quota */
  }
  window.dispatchEvent(new CustomEvent("bhb-marketing-spend"));
}
export function marketingSpendIsEmpty(s: MarketingSpendState): boolean {
  return s.entries.length === 0 && !s.updatedAt;
}

/* ─── Attribution ──────────────────────────────────────────────────── */

export type AttributionRow = {
  key: string;
  /** "campaign" rows carry campaignId; "source" rows aggregate a source */
  level: "campaign" | "source";
  label: string;
  source: string;
  campaignId: string;
  leads: number;
  registered: number;
  enrolled: number;
  lost: number;
  /** null = no spend recorded */
  spendPaise: number | null;
  costPerLeadPaise: number | null;
  costPerEnrolmentPaise: number | null;
  conversionPct: number;
};

function inPeriod(lead: AdmissionLead, from: string, to: string): boolean {
  const d = lead.leadDate || lead.createdAt.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/**
 * Roll-up: one row per source (all leads), plus one row per campaignId seen
 * on leads. Spend entries attach to the campaignId row when set, else to
 * the source row; period-bound entries only count leads in the period.
 */
export function campaignAttribution(leads: AdmissionLead[], spend: SpendEntry[]): AttributionRow[] {
  const rows = new Map<string, AttributionRow>();
  const mk = (key: string, level: "campaign" | "source", label: string, source: string, campaignId: string): AttributionRow =>
    rows.get(key) ?? { key, level, label, source, campaignId, leads: 0, registered: 0, enrolled: 0, lost: 0, spendPaise: null, costPerLeadPaise: null, costPerEnrolmentPaise: null, conversionPct: 0 };
  const bump = (r: AttributionRow, l: AdmissionLead) => {
    r.leads += 1;
    if (l.stage === "applied" || l.stage === "verified" || l.stage === "enrolled" || l.registrationPaymentStatus === "paid") r.registered += 1;
    if (l.stage === "enrolled") r.enrolled += 1;
    if (l.stage === "lost") r.lost += 1;
    rows.set(r.key, r);
  };
  for (const l of leads) {
    bump(mk(`src:${l.source}`, "source", sourceLabel(l.source as AdmissionSource), l.source, ""), l);
    if (l.campaignId) bump(mk(`cmp:${l.campaignId}`, "campaign", l.campaignId, l.source, l.campaignId), l);
  }
  // Spend.
  for (const e of spend) {
    const key = e.campaignId ? `cmp:${e.campaignId}` : e.source ? `src:${e.source}` : "";
    if (!key) continue;
    const r = rows.get(key) ?? mk(key, e.campaignId ? "campaign" : "source", e.campaignId || sourceLabel(e.source as AdmissionSource), e.source, e.campaignId);
    if (e.label && r.level === "campaign") r.label = `${e.campaignId} · ${e.label}`;
    // Period-bound spend: recount the leads inside the period for cost math.
    r.spendPaise = (r.spendPaise ?? 0) + e.amountPaise;
    rows.set(key, r);
    if (e.from || e.to) {
      const inP = leads.filter((l) => (e.campaignId ? l.campaignId === e.campaignId : l.source === e.source) && inPeriod(l, e.from, e.to));
      // Only narrow if the period has leads — otherwise keep the full count and let the cost read high.
      if (inP.length) {
        r.leads = inP.length;
        r.enrolled = inP.filter((l) => l.stage === "enrolled").length;
      }
    }
  }
  for (const r of rows.values()) {
    r.conversionPct = r.leads ? Math.round((r.enrolled / r.leads) * 1000) / 10 : 0;
    if (r.spendPaise != null) {
      r.costPerLeadPaise = r.leads ? Math.round(r.spendPaise / r.leads) : null;
      r.costPerEnrolmentPaise = r.enrolled ? Math.round(r.spendPaise / r.enrolled) : null;
    }
  }
  return [...rows.values()].sort((a, b) => (a.level === b.level ? b.leads - a.leads : a.level === "source" ? -1 : 1));
}

export const inrPaise = (p: number | null) => (p == null ? "—" : `₹${Math.round(p / 100).toLocaleString("en-IN")}`);
