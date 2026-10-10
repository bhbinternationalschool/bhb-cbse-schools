/**
 * Fee dashboard ← what families still owe the STORE.
 *
 * Books and uniform bought on credit are the store's money, not the fee
 * book's. They are settled at the store counter against the fee receipt
 * (`collectOnSale`, with the receipt as the reference), and nothing else —
 * no pay link, no parent app — can settle one yet. So they are shown BESIDE
 * the fee dues and never added into them: a bigger "Open dues" figure that
 * a pay link cannot collect would be a worse lie than not showing it.
 *
 * They are also read live rather than mirrored into the fee tables, because
 * the fee desk rebuilds those wholesale and would delete a mirrored copy.
 *
 * On any failure the fee-only figures stay exactly as they were — the tile
 * simply does not mention the store.
 */

import { formatInrCompact } from "@/lib/masters";
import type { ModuleDashboardModel } from "@/components/dashboard/ModuleDashboard";

export type StoreDuesSummary = {
  balancePaise: number;
  saleCount: number;
  studentCount: number;
};

export async function fetchStoreDuesSummary(): Promise<StoreDuesSummary | null> {
  try {
    const res = await fetch("/api/inventory/sales?view=dues-summary", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      ok?: boolean;
      summary?: StoreDuesSummary;
    };
    if (body.ok === false || !body.summary) return null;
    return body.summary;
  } catch {
    return null;
  }
}

export type OpenDuesSummary = {
  totalBalancePaise: number;
  students: number;
  families: number;
  rows: number;
  rebuiltAt: string;
};

/**
 * What the reminders and the pay links are built from.
 *
 * The fee dashboard computed its own total from the browser's copy of the
 * fee book while the main dashboard computed one on the server, and the two
 * disagreed — by ₹2 lakh on 16 Sep 2026, because the server could not see
 * the bus fee. Even with that fixed, two computations over two copies of the
 * data will drift. One figure, from the table the parent's message is built
 * from, cannot.
 */
export async function fetchOpenDuesSummary(
  academicYearCode?: string,
): Promise<OpenDuesSummary | null> {
  try {
    const qs = academicYearCode ? `?ay=${encodeURIComponent(academicYearCode)}` : "";
    const res = await fetch(`/api/fees/open-dues-summary${qs}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean } & OpenDuesSummary;
    if (body.ok === false) return null;
    return body;
  } catch {
    return null;
  }
}

/** How stale the dues cache is, in words the office can act on. */
export function duesFreshnessHint(rebuiltAt: string, now = new Date()): string {
  if (!rebuiltAt) return "not rebuilt yet";
  const at = new Date(rebuiltAt);
  if (Number.isNaN(at.getTime())) return "";
  const hours = Math.floor((now.getTime() - at.getTime()) / 3_600_000);
  if (hours < 1) return "just rebuilt";
  if (hours < 24) return `rebuilt ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `rebuilt ${days} day${days === 1 ? "" : "s"} ago — collect a fee to refresh`;
}

/**
 * Put the one dues figure on the tile, and name the store dues beside it.
 * Null = leave the model exactly as it was.
 */
export async function patchFeeDashWithStoreDues(
  model: ModuleDashboardModel,
  academicYearCode?: string,
): Promise<ModuleDashboardModel | null> {
  const [store, dues] = await Promise.all([
    fetchStoreDuesSummary(),
    fetchOpenDuesSummary(academicYearCode),
  ]);
  if (!store && !dues) return null;

  let changed = false;
  const kpis = (model.kpis ?? []).map((k) => {
    if (k.id !== "open") return k;
    changed = true;
    const bits: string[] = [];
    if (dues) {
      bits.push(`${dues.students} students · ${duesFreshnessHint(dues.rebuiltAt)}`);
    } else {
      bits.push(String(k.hint ?? ""));
    }
    if (store && store.balancePaise > 0) {
      bits.push(
        `plus ${formatInrCompact(store.balancePaise)} books/uniform (${store.studentCount})`,
      );
    }
    return {
      ...k,
      value: dues ? formatInrCompact(dues.totalBalancePaise) : k.value,
      hint: bits.filter(Boolean).join(" · "),
    };
  });
  if (!changed) return null;
  return { ...model, kpis };
}
