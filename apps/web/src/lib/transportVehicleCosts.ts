/**
 * What a vehicle costs and which papers it holds — read from the stores that
 * are kept, not the transport desk's retired lists.
 *
 * Until 14 Oct 2026 the Vehicle 360 card, the fleet reports, TCO and the
 * fleet WhatsApp "paper expiring" alert read the desk's fuelRefillLogs,
 * vehicle.compliance[], emiSchedule, insurancePolicies and
 * certificateRenewals. Those were either frozen (fuel: 48 entries, last
 * 8 Sep) or never saved to the server (papers, loans, EMIs) — so the alert
 * could never fire and TCO said ₹0 EMI for buses with three live loans.
 * Now:
 *
 *   - FUEL     transport_fuel_fills (lib/transportFuelRegister*), voided
 *              fills excluded from every figure.
 *   - PAPERS   module_local_state transport_vehicle_docs
 *              (lib/transportFinance*), the document in force per type.
 *   - LOANS    Ledger v2 vehicle-loan accounts; which bus a loan is for is
 *              transport_loan_links. A loan not linked to a bus is NOT
 *              assumed to be some other bus's: the EMI figure says unknown.
 *
 * Unknown is never 0: a part that could not be read, or that the reader may
 * not see, is null with a reason, and the total says it is incomplete.
 *
 * Pure: runs on the server, in the browser and in tests.
 */

import {
  currentDocsFor,
  DEFAULT_EMI_DUE_DAY,
  dueDateIn,
  expiryStatus,
  VEHICLE_DOC_LABELS,
  VEHICLE_DOC_TYPES,
  type VehicleDoc,
  type VehicleDocType,
} from "@/lib/transportFinance";
import {
  accountsStatus,
  kmBetweenFills,
  type FillAccountsFacts,
  type FuelAccountsStatus,
  type TotalsFill,
} from "@/lib/transportFuelRegister";

/* ─── shapes the route serves ─────────────────────────────── */

/** One register fill as the readers need it (GET /api/transport/vehicle-costs). */
export type CostFill = TotalsFill &
  FillAccountsFacts & {
    fuelType: string;
    status: FuelAccountsStatus;
  };

/** One ledger vehicle loan, trimmed to what TCO and the EMI register read. */
export type CostLoan = {
  code: string;
  name: string;
  vehicleId: string;
  vehicleLabel: string;
  /** Day of the month the EMI falls due (the link's, else the default). */
  emiDueDay: number;
  outstandingPaise: number;
  principalPaidPaise: number;
  interestPaidPaise: number;
  emis: { voucherNo: string; date: string; principalPaise: number; interestPaise: number }[];
  missingMonths: string[];
  nextDueOn: string;
};

/** Loans: read, or why not. */
export type CostLoans =
  | { known: true; loans: CostLoan[] }
  | { known: false; reason: string };

export type VehicleCosts = {
  /** null = the register could not be read. */
  fills: CostFill[] | null;
  fillsError?: string;
  /** null = the papers store could not be read. */
  docs: VehicleDoc[] | null;
  loans: CostLoans;
};

/** Attach the accounts status the Fuel tab shows to a register fill. */
export function toCostFill<T extends TotalsFill & FillAccountsFacts & { fuelType: string }>(f: T): CostFill {
  return {
    id: f.id,
    vehicleId: f.vehicleId,
    fillDate: f.fillDate,
    createdAt: f.createdAt,
    odometerKm: f.odometerKm,
    voided: f.voided,
    quantity: f.quantity,
    unit: f.unit,
    amountPaise: f.amountPaise,
    fuelType: f.fuelType,
    voucherId: f.voucherId,
    voucherNo: f.voucherNo,
    voucherOrigin: f.voucherOrigin,
    paymentMode: f.paymentMode,
    entrySource: f.entrySource,
    reversalVoucherNo: f.reversalVoucherNo ?? "",
    status: accountsStatus(f),
  };
}

/** A ledger loan view (lib/transportFinance.server buildVehicleLoans) trimmed. */
export function toCostLoan(l: {
  code: string;
  name: string;
  link: { vehicleId: string; emiDueDay: number } | null;
  vehicleLabel: string;
  summary: {
    outstandingPaise: number;
    principalPaidPaise: number;
    interestPaidPaise: number;
    emis: CostLoan["emis"];
    missingMonths: string[];
    nextDueOn: string;
  };
}): CostLoan {
  return {
    code: l.code,
    name: l.name,
    vehicleId: l.link?.vehicleId ?? "",
    vehicleLabel: l.vehicleLabel,
    emiDueDay: l.link?.emiDueDay ?? DEFAULT_EMI_DUE_DAY,
    outstandingPaise: l.summary.outstandingPaise,
    principalPaidPaise: l.summary.principalPaidPaise,
    interestPaidPaise: l.summary.interestPaidPaise,
    emis: l.summary.emis,
    missingMonths: l.summary.missingMonths,
    nextDueOn: l.summary.nextDueOn,
  };
}

/* ─── papers ──────────────────────────────────────────────── */

export type VehiclePaper = {
  type: VehicleDocType;
  label: string;
  expiresOn: string;
  number: string;
  doc: VehicleDoc;
};

/** The papers in force on one vehicle (one per type), soonest expiry first. */
export function vehiclePapers(docs: readonly VehicleDoc[], vehicleId: string): VehiclePaper[] {
  const cur = currentDocsFor(docs, vehicleId);
  const out: VehiclePaper[] = [];
  for (const t of VEHICLE_DOC_TYPES) {
    const d = cur[t];
    if (!d) continue;
    out.push({ type: t, label: VEHICLE_DOC_LABELS[t], expiresOn: d.expiresOn, number: d.number || d.policyNo, doc: d });
  }
  return out.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.label.localeCompare(b.label));
}

/**
 * The fleet alert's input shape (lib/fleetLive AlertVehicleLike.compliance):
 * the paper in force per type, under its printed name.
 */
export function papersAsCompliance(docs: readonly VehicleDoc[], vehicleId: string): { certType: string; expiryDate: string }[] {
  return vehiclePapers(docs, vehicleId).map((p) => ({ certType: p.label, expiryDate: p.expiresOn }));
}

export type ComplianceCalendarRow = {
  vehicleId: string;
  paper: string;
  number: string;
  issuedOn: string;
  expiresOn: string;
  /** null when no paper of this type is recorded. */
  daysLeft: number | null;
  status: "Expired" | "Due soon" | "OK" | "Not recorded" | "No expiry date";
  feePaise: number;
  insurer: string;
  note: string;
};

/**
 * One row per vehicle per paper type: the paper in force, or "Not recorded".
 * A type nobody recorded is listed rather than dropped — the calendar must not
 * read as "all clear" for a bus whose fitness was never entered. Worst first,
 * then by expiry; "Not recorded" last.
 */
export function complianceCalendarRows(
  docs: readonly VehicleDoc[],
  vehicleIds: readonly string[],
  today: string,
): ComplianceCalendarRow[] {
  const rank: Record<ComplianceCalendarRow["status"], number> = { Expired: 0, "Due soon": 1, "No expiry date": 2, OK: 3, "Not recorded": 4 };
  const rows: ComplianceCalendarRow[] = [];
  for (const vehicleId of vehicleIds) {
    const cur = currentDocsFor(docs, vehicleId);
    for (const t of VEHICLE_DOC_TYPES) {
      const d = cur[t];
      if (!d) {
        rows.push({ vehicleId, paper: VEHICLE_DOC_LABELS[t], number: "", issuedOn: "", expiresOn: "", daysLeft: null, status: "Not recorded", feePaise: 0, insurer: "", note: "" });
        continue;
      }
      const s = expiryStatus(d.expiresOn, today);
      rows.push({
        vehicleId,
        paper: VEHICLE_DOC_LABELS[t],
        number: d.number || d.policyNo,
        issuedOn: d.issuedOn,
        expiresOn: d.expiresOn,
        daysLeft: s.daysLeft,
        status: s.status === "expired" ? "Expired" : s.status === "due" ? "Due soon" : s.status === "ok" ? "OK" : "No expiry date",
        feePaise: d.feePaise,
        insurer: d.insurer,
        note: d.note,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.expiresOn || "9999").localeCompare(b.expiresOn || "9999") ||
      a.vehicleId.localeCompare(b.vehicleId) ||
      a.paper.localeCompare(b.paper),
  );
}

/* ─── fuel ─────────────────────────────────────────────────── */

export type FuelVehicleRow = {
  vehicleId: string;
  fills: number;
  litres: number;
  kg: number;
  amountPaise: number;
  /** Km from consecutive odometer readings; null when no pair of readings exists. */
  km: number | null;
  /** Fills whose km is known (out of `fills`). */
  fillsWithKm: number;
  rupeesPerKm: number | null;
  kmPerUnit: number | null;
  kmPerUnitUnit: "litre" | "kg" | null;
  inAccounts: number;
  notInAccounts: number;
  awaitingOffice: number;
  voided: number;
};

/**
 * Per vehicle over the fills given (the caller picks the period). Voided fills
 * are counted in `voided` only. Km, ₹/km and km per unit follow the Fuel
 * tab's rule (busMonthTotals): only from readings that exist, null otherwise;
 * km per unit only when the vehicle used one unit.
 */
export function fuelByVehicle(fills: readonly CostFill[], vehicleIds?: readonly string[]): FuelVehicleRow[] {
  const kmByFill = kmBetweenFills([...fills]);
  const ids = vehicleIds ? [...vehicleIds] : [...new Set(fills.map((f) => f.vehicleId))];
  return ids.map((vehicleId) => {
    const mine = fills.filter((f) => f.vehicleId === vehicleId);
    const live = mine.filter((f) => !f.voided);
    const litres = live.filter((f) => f.unit === "litre").reduce((n, f) => n + f.quantity, 0);
    const kg = live.filter((f) => f.unit === "kg").reduce((n, f) => n + f.quantity, 0);
    const amountPaise = live.reduce((n, f) => n + f.amountPaise, 0);
    const kms = live.map((f) => kmByFill.get(f.id)).filter((k): k is number => k != null);
    const km = kms.length ? Math.round(kms.reduce((n, k) => n + k, 0) * 10) / 10 : null;
    const units = new Set(live.map((f) => f.unit));
    const oneUnit = units.size === 1 ? [...units][0]! : null;
    const qty = oneUnit === "kg" ? kg : oneUnit === "litre" ? litres : 0;
    return {
      vehicleId,
      fills: live.length,
      litres: Math.round(litres * 100) / 100,
      kg: Math.round(kg * 100) / 100,
      amountPaise,
      km,
      fillsWithKm: kms.length,
      rupeesPerKm: km != null && km > 0 && amountPaise > 0 ? Math.round((amountPaise / 100 / km) * 100) / 100 : null,
      kmPerUnit: km != null && km > 0 && oneUnit && qty > 0 ? Math.round((km / qty) * 100) / 100 : null,
      kmPerUnitUnit: km != null && km > 0 && oneUnit && qty > 0 ? oneUnit : null,
      inAccounts: live.filter((f) => f.status.kind === "in_accounts").length,
      notInAccounts: live.filter((f) => f.status.kind === "not_in_accounts").length,
      awaitingOffice: live.filter((f) => f.status.kind === "awaiting_office").length,
      voided: mine.length - live.length,
    };
  });
}

/** The latest fills of one vehicle (voided ones included, marked), newest first. */
export function recentFills(fills: readonly CostFill[], vehicleId: string, n = 8): CostFill[] {
  return fills
    .filter((f) => f.vehicleId === vehicleId)
    .sort((a, b) => b.fillDate.localeCompare(a.fillDate) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .slice(0, n);
}

/* ─── TCO ──────────────────────────────────────────────────── */

/** One cost part: null = unknown; partial = a floor, more may exist. */
export type TcoPart = { paise: number | null; partial: boolean; note: string };

export type VehicleTco = {
  fuel: TcoPart;
  emiPrincipal: TcoPart;
  interest: TcoPart;
  insurance: TcoPart;
  papers: TcoPart;
  jobs: TcoPart;
  /** Sum of the parts that are known. */
  knownTotalPaise: number;
  /** True only when every part is known and none is partial. */
  complete: boolean;
  /** Names of the parts that are unknown or partial, for the label. */
  gaps: string[];
};

const known = (paise: number, note = ""): TcoPart => ({ paise, partial: false, note });
const unknown = (note: string): TcoPart => ({ paise: null, partial: false, note });

/**
 * A vehicle's cost of ownership to date.
 *
 * Fuel: non-voided register fills. EMI principal and interest: every EMI the
 * books hold on the loans linked to this vehicle; while any loan account is
 * linked to no bus, a vehicle with none linked is unknown (it may be that
 * loan's bus) and one with some linked is a floor. Insurance / other papers:
 * the fees on the vehicle's live documents (history included — each renewal
 * was paid); a document with no fee entered makes the part a floor.
 * Service & repairs: the desk's completed job cards (still the only record).
 */
export function vehicleTco(input: {
  vehicleId: string;
  fills: readonly CostFill[] | null;
  docs: readonly VehicleDoc[] | null;
  loans: CostLoans;
  jobsPaise: number;
}): VehicleTco {
  const { vehicleId } = input;

  const fuel = input.fills
    ? known(
        input.fills.filter((f) => f.vehicleId === vehicleId && !f.voided).reduce((n, f) => n + f.amountPaise, 0),
      )
    : unknown("fuel register could not be read");

  let emiPrincipal: TcoPart;
  let interest: TcoPart;
  if (!input.loans.known) {
    emiPrincipal = unknown(input.loans.reason);
    interest = unknown(input.loans.reason);
  } else {
    const mine = input.loans.loans.filter((l) => l.vehicleId === vehicleId);
    const unlinked = input.loans.loans.filter((l) => !l.vehicleId);
    const unlinkedNote = unlinked.length
      ? `${unlinked.length} loan account${unlinked.length === 1 ? "" : "s"} not linked to a bus (Transport → Finance)`
      : "";
    if (mine.length === 0 && unlinked.length > 0) {
      emiPrincipal = unknown(unlinkedNote);
      interest = unknown(unlinkedNote);
    } else {
      const partial = unlinked.length > 0;
      const p = mine.reduce((n, l) => n + l.principalPaidPaise, 0);
      const i = mine.reduce((n, l) => n + l.interestPaidPaise, 0);
      const note = mine.length === 0 ? "no loan on this vehicle" : unlinkedNote;
      emiPrincipal = { paise: p, partial, note };
      interest = { paise: i, partial, note };
    }
  }

  let insurance: TcoPart;
  let papers: TcoPart;
  if (!input.docs) {
    insurance = unknown("vehicle papers could not be read");
    papers = unknown("vehicle papers could not be read");
  } else {
    const live = input.docs.filter((d) => d.vehicleId === vehicleId && d.status === "active");
    const part = (list: VehicleDoc[]): TcoPart => {
      const noFee = list.filter((d) => !(d.feePaise > 0)).length;
      return {
        paise: list.reduce((n, d) => n + (d.feePaise > 0 ? d.feePaise : 0), 0),
        partial: noFee > 0,
        note: noFee ? `${noFee} paper${noFee === 1 ? "" : "s"} with no fee entered` : list.length ? "" : "none recorded",
      };
    };
    insurance = part(live.filter((d) => d.type === "insurance"));
    papers = part(live.filter((d) => d.type !== "insurance"));
  }

  const jobs = known(Math.max(0, Math.round(input.jobsPaise)));

  const parts: [string, TcoPart][] = [
    ["fuel", fuel],
    ["EMI", emiPrincipal],
    ["interest", interest],
    ["insurance", insurance],
    ["papers", papers],
    ["service", jobs],
  ];
  const gaps = parts.filter(([, p]) => p.paise == null || p.partial).map(([k]) => k);
  return {
    fuel,
    emiPrincipal,
    interest,
    insurance,
    papers,
    jobs,
    knownTotalPaise: parts.reduce((n, [, p]) => n + (p.paise ?? 0), 0),
    complete: gaps.length === 0,
    gaps,
  };
}

/** "₹1,200", "₹1,200+" (a floor) or "unknown". */
export function tcoPartText(p: TcoPart, fmt: (paise: number) => string): string {
  if (p.paise == null) return "unknown";
  return p.partial ? `${fmt(p.paise)}+` : fmt(p.paise);
}

/** The total, saying what it leaves out: "₹9,000" or "₹9,000 + unknown (EMI, interest)". */
export function tcoTotalText(t: VehicleTco, fmt: (paise: number) => string): string {
  return t.complete ? fmt(t.knownTotalPaise) : `${fmt(t.knownTotalPaise)} + unknown (${t.gaps.join(", ")})`;
}

/* ─── EMI register ─────────────────────────────────────────── */

export type EmiRegisterRow = {
  loanCode: string;
  loanName: string;
  vehicleId: string;
  vehicleLabel: string;
  date: string;
  voucherNo: string;
  principalPaise: number | null;
  interestPaise: number | null;
  status: "Posted" | "Not posted" | "Next due";
};

/**
 * Every EMI the books hold per vehicle loan, plus each month whose EMI date
 * passed with nothing posted ("Not posted") and the next due date. A month
 * not posted has no amount — the lender's schedule is not in the system.
 */
export function emiRegisterRows(loans: readonly CostLoan[]): EmiRegisterRow[] {
  const rows: EmiRegisterRow[] = [];
  for (const l of loans) {
    const base = { loanCode: l.code, loanName: l.name, vehicleId: l.vehicleId, vehicleLabel: l.vehicleLabel };
    for (const e of l.emis) {
      rows.push({ ...base, date: e.date, voucherNo: e.voucherNo, principalPaise: e.principalPaise, interestPaise: e.interestPaise, status: "Posted" });
    }
    for (const m of l.missingMonths) {
      rows.push({ ...base, date: dueDateIn(m, l.emiDueDay), voucherNo: "", principalPaise: null, interestPaise: null, status: "Not posted" });
    }
    if (l.nextDueOn) {
      rows.push({ ...base, date: l.nextDueOn, voucherNo: "", principalPaise: null, interestPaise: null, status: "Next due" });
    }
  }
  return rows.sort((a, b) => a.loanCode.localeCompare(b.loanCode) || a.date.localeCompare(b.date));
}
