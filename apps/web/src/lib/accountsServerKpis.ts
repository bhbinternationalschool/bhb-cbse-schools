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
  banks?: { code: string; name: string; closingPaise: number }[];
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

export async function patchAccountsDashWithServerBook(
  model: ModuleDashboardModel,
): Promise<ModuleDashboardModel | null> {
  const today = todayIso();
  // "position" is the cockpit without its controls: the same balances in a
  // fraction of the time. The controls run over every voucher and took several
  // seconds, during which the dashboard showed browser-book figures.
  const [cockpit, rp] = await Promise.all([
    ledgerPost<Position>({ action: "position", asOf: today, fyFrom: fyStart() }),
    ledgerPost<{ ok: boolean; report?: { totalReceiptsPaise: number } }>({
      action: "receipts-payments",
      from: today,
      to: today,
    }),
  ]);
  if (!cockpit?.ok) return null;

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

  return {
    ...model,
    subtitle:
      "Cash, banks, payables and today’s money — read from the server book (same figures as the Server book tab).",
    chartTitle: "Fee counter collections — last 7 days (₹)",
    kpis,
  };
}
