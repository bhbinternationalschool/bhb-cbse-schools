/**
 * UDISE+ School Profile → Section 1(c) "Receipts and Expenditure"
 * (tab "1.59 to 1.62" on profile.udiseplus.gov.in, 2026-27). For a private
 * unaided school it asks about the PREVIOUS academic year:
 *  - financial assistance received from an NGO / PSU / the community /
 *    others (yes/no, name, amount);
 *  - whether inventory registers are kept (ICT, sports equipment, library);
 *  - total annual expenditure: maintenance / housekeeping, teachers,
 *    construction works, others (and their total).
 * (Grants under Samagra Shiksha are for government and aided schools.)
 *
 * Where the figures come from (7 Oct 2026): NOT the ERP's own books — most
 * of 2025-26 was kept in the old ERP, whose trial balances disagree with its
 * own ledgers, and the payroll was never posted. The true figures are the
 * audited accounts / ITR-7. So the office types them here once a year, a
 * named person confirms, and the robot fills the portal from that.
 */

export const UDISE_SCHOOL_FINANCE_KEY = "udise_school_finance" as const;
export const FINANCE_SECTION_KEY = "1.59-1.62";

export type AssistanceSource = "ngo" | "psu" | "community" | "other";
export type Assistance = { received: boolean | null; name: string; amount: string };

export type FinanceYear = {
  maintenance: string;
  teachers: string;
  construction: string;
  others: string;
  assistance: Record<AssistanceSource, Assistance>;
  /** Where the office took the figures from, e.g. "Audited accounts FY 2025-26". */
  source: string;
  confirmedBy: string;
  confirmedAt: string;
};

export type FinanceStore = { years: Record<string, FinanceYear> };

export const ASSISTANCE_LABEL: Record<AssistanceSource, string> = {
  ngo: "Non-Govt. Organisation (NGO)",
  psu: "Public Sector Undertaking (PSU)",
  community: "Community",
  other: "Other",
};

const rupees = (v: unknown): string => {
  const t = String(v ?? "").replace(/[,\s₹]/g, "").trim();
  if (!t) return "";
  return /^\d{1,10}$/.test(t) ? String(Number(t)) : "";
};

export function emptyFinanceYear(): FinanceYear {
  const a = (): Assistance => ({ received: null, name: "", amount: "" });
  return {
    maintenance: "",
    teachers: "",
    construction: "",
    others: "",
    assistance: { ngo: a(), psu: a(), community: a(), other: a() },
    source: "",
    confirmedBy: "",
    confirmedAt: "",
  };
}

/** Clean one year as typed. Rupees are whole numbers; a bad figure is dropped, not guessed. */
export function normalizeFinanceYear(raw: unknown): FinanceYear {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = emptyFinanceYear();
  out.maintenance = rupees(r.maintenance);
  out.teachers = rupees(r.teachers);
  out.construction = rupees(r.construction);
  out.others = rupees(r.others);
  const as = (r.assistance && typeof r.assistance === "object" ? r.assistance : {}) as Record<string, unknown>;
  for (const k of Object.keys(out.assistance) as AssistanceSource[]) {
    const x = (as[k] && typeof as[k] === "object" ? as[k] : {}) as Record<string, unknown>;
    const received = x.received === true ? true : x.received === false ? false : null;
    out.assistance[k] = {
      received,
      // Name and amount only mean something when assistance was received.
      name: received ? String(x.name ?? "").trim().slice(0, 120) : "",
      amount: received ? rupees(x.amount) : "",
    };
  }
  out.source = String(r.source ?? "").trim().slice(0, 160);
  out.confirmedBy = String(r.confirmedBy ?? "").trim();
  out.confirmedAt = String(r.confirmedAt ?? "").trim();
  return out;
}

export function normalizeFinanceStore(raw: unknown): FinanceStore {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ys = (r.years && typeof r.years === "object" ? r.years : {}) as Record<string, unknown>;
  const years: Record<string, FinanceYear> = {};
  for (const [k, v] of Object.entries(ys)) if (/^20\d{2}-\d{2}$/.test(k)) years[k] = normalizeFinanceYear(v);
  return { years };
}

export function financeTotal(y: FinanceYear): string {
  const parts = [y.maintenance, y.teachers, y.construction, y.others];
  if (parts.every((p) => p === "")) return "";
  return String(parts.reduce((n, p) => n + (p ? Number(p) : 0), 0));
}

/** The portal's 1(c) for academic year "2026-27" asks about "2025-26". */
export function previousYear(ay: string): string {
  const m = ay.match(/^(20\d{2})-\d{2}$/);
  if (!m) return "";
  const s = Number(m[1]) - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
}

/** A confirmed year only: unsigned figures are not figures. */
export function confirmedYear(store: FinanceStore, fy: string): FinanceYear | null {
  const y = store.years[fy];
  return y && y.confirmedBy && y.confirmedAt ? y : null;
}

export type FinanceRule = { label: string; value: string; test: (label: string) => boolean };

const ROW = {
  ngo: /\bngo\b|non-?\s*govt|non-?\s*government/i,
  psu: /\bpsu\b|public\s*sector/i,
  community: /community/i,
  other: /\bother\b(?!s)/i,
};

/**
 * Label rules for the 1(c) boxes the robot captured, built from a confirmed
 * year. Only plain number/text boxes are ever filled (lib/udiseSchoolProfile);
 * the yes/no radios are left for the person.
 */
export function financeRules(y: FinanceYear, fy: string): FinanceRule[] {
  const rules: FinanceRule[] = [];
  const exp = (re: RegExp, value: string, label: string) => {
    if (value) rules.push({ label: `${label} (FY ${fy})`, value, test: (l) => re.test(l) && !/grant|assistance|amount\s*received/i.test(l) });
  };
  exp(/maintenance|house\s*-?\s*keeping/i, y.maintenance, "Expenditure: maintenance / housekeeping");
  exp(/\bteachers?\b(?!.*training)/i, y.teachers, "Expenditure: teachers");
  exp(/construction/i, y.construction, "Expenditure: construction works");
  exp(/\bothers\b/i, y.others, "Expenditure: others");
  const total = financeTotal(y);
  if (total) rules.push({ label: `Total expenditure (FY ${fy})`, value: total, test: (l) => /total/i.test(l) && /expend/i.test(l) });
  for (const k of Object.keys(ROW) as AssistanceSource[]) {
    const a = y.assistance[k];
    if (!a.received) continue;
    if (a.amount) rules.push({ label: `${ASSISTANCE_LABEL[k]}: amount (FY ${fy})`, value: a.amount, test: (l) => ROW[k].test(l) && /amount/i.test(l) });
    if (a.name) rules.push({ label: `${ASSISTANCE_LABEL[k]}: name (FY ${fy})`, value: a.name, test: (l) => ROW[k].test(l) && /\bname\b/i.test(l) });
  }
  return rules;
}
