/**
 * Accounts dashboard ← server book.
 *
 * The dashboard's KPIs used to read the browser book, while store sales (and
 * everything else the projection carries) post into the Ledger v2 server
 * book — so a store sale moved the "Server book" tab but not the KPIs, and
 * the two screens drifted apart with every entry. The KPIs now read the same
 * cockpit the Server book tab shows: one set of figures, one truth.
 * On any failure the browser-book numbers stay — worse but never blank.
 */

import { formatInr } from "@/lib/masters";
import type { ModuleDashboardModel } from "@/components/dashboard/ModuleDashboard";

type Position = {
  ok: boolean;
  cashPaise: number;
  bankPaise: number;
  banks?: {
    code: string;
    name: string;
    closingPaise: number;
    bankAccountId?: string;
  }[];
  chequesInHandPaise: number;
  payablesPaise: number;
  receivablesPaise: number;
  incomeThisYearPaise: number;
  expenditureThisYearPaise: number;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fyStart(): string {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-04-01`;
}

async function ledgerPost<T>(body: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch("/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type MonthlyCashRow = {
  month: string;
  label: string;
  inPaise: number;
  outPaise: number;
  netPaise: number;
};

/** Money in and money out, month by month, from the server book. */
async function monthlyCash(from: string, to: string): Promise<MonthlyCashRow[]> {
  const res = await ledgerPost<{ ok: boolean; rows?: MonthlyCashRow[] }>({
    action: "monthly-cash",
    from,
    to,
  });
  return res?.ok ? (res.rows ?? []) : [];
}

export async function patchAccountsDashWithServerBook(
  model: ModuleDashboardModel,
): Promise<ModuleDashboardModel | null> {
  const today = todayIso();
  // "position" is the cockpit without its controls: the same balances in a
  // fraction of the time. The controls run over every voucher and took several
  // seconds, during which the dashboard showed browser-book figures.
  const [cockpit, rp, months] = await Promise.all([
    ledgerPost<Position>({ action: "position", asOf: today, fyFrom: fyStart() }),
    ledgerPost<{ ok: boolean; report?: { totalReceiptsPaise: number } }>({
      action: "receipts-payments",
      from: today,
      to: today,
    }),
    monthlyCash(fyStart(), today),
  ]);
  if (!cockpit?.ok) {
    // The server book could not be read. The base model already leaves the
    // money tiles and the bank rows blank, so returning null leaves them
    // blank — which is the point. Filling them from the desk book is what
    // put two different bank balances in front of the office (2026-09-06).
    return null;
  }

  const todayInPaise = rp?.ok ? rp.report?.totalReceiptsPaise ?? null : null;

  const kpis = model.kpis.map((k) => {
    if (k.id === "today" && todayInPaise != null) {
      return {
        ...k,
        value: formatInr(todayInPaise),
        hint: "server book · fees + store + all receipts",
      };
    }
    if (k.id === "cash") {
      return { ...k, value: formatInr(cockpit.cashPaise), hint: "server book" };
    }
    if (k.id === "bank") {
      const banks = (cockpit.banks ?? []).filter((b) => b.code !== "1010");
      const hint = banks.length
        ? banks.map((b) => `${b.name.split("·")[0]!.trim()} ${formatInr(b.closingPaise)}`).join(" · ")
        : "server book";
      return { ...k, value: formatInr(cockpit.bankPaise), hint };
    }
    if (k.id === "ap") {
      return {
        ...k,
        value: formatInr(cockpit.payablesPaise),
        hint: "server book",
      };
    }
    return k;
  });

  // The dashboard's bank list is built blank for the same reason; fill it
  // here, matching each desk bank to the ledger account that stands for it.
  const byDeskId = new Map(
    (cockpit.banks ?? [])
      .filter((b) => b.bankAccountId)
      .map((b) => [String(b.bankAccountId), b.closingPaise] as const),
  );
  const tableRows = (model.tableRows ?? []).map((row) => {
    const paise = byDeskId.get(String(row.id ?? ""));
    return paise === undefined
      ? row
      : { ...row, balance: formatInr(paise) };
  });

  // Month by month, in rupees. Money in and money out get a chart each
  // rather than one netted line: a month that took ₹4L and spent ₹3.9L is
  // not the same month as one that took ₹10,000 and spent nothing, and a
  // net-only bar hides exactly that. The table under them carries both
  // sides and the net, so the figure can be checked against the Receipts &
  // Payments statement for the same month.
  const monthRows = months ?? [];
  const extraCharts = [...(model.extraCharts ?? [])];
  const extraTables = [...(model.extraTables ?? [])];
  if (monthRows.length > 0) {
    extraCharts.push({
      title: "Money in, month by month (₹)",
      series: monthRows.map((m) => ({
        label: m.label,
        value: Math.round(m.inPaise / 100),
        date: `${m.month}-01`,
        color: "#15803d",
      })),
      defaultView: "trend",
    });
    extraCharts.push({
      title: "Money out, month by month (₹)",
      series: monthRows.map((m) => ({
        label: m.label,
        value: Math.round(m.outPaise / 100),
        date: `${m.month}-01`,
        color: "#b91c1c",
      })),
      defaultView: "trend",
    });
    extraTables.push({
      title: "Month by month — server book",
      columns: [
        { key: "month", label: "Month" },
        { key: "moneyIn", label: "Money in", align: "right" },
        { key: "moneyOut", label: "Money out", align: "right" },
        { key: "net", label: "Net", align: "right" },
      ],
      rows: monthRows.map((m) => ({
        id: m.month,
        month: m.label,
        moneyIn: formatInr(m.inPaise),
        moneyOut: formatInr(m.outPaise),
        net: formatInr(m.netPaise),
      })),
    });
  }

  return {
    ...model,
    tableRows,
    subtitle:
      "Cash, banks, payables and today’s money — read from the server book (same figures as the Server book tab).",
    chartTitle: "Fee counter collections — last 7 days (₹)",
    kpis,
    extraCharts,
    extraTables,
  };
}
