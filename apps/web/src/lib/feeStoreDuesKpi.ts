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

/** Name the store dues on the "Open dues" tile. Null = leave the model be. */
export async function patchFeeDashWithStoreDues(
  model: ModuleDashboardModel,
): Promise<ModuleDashboardModel | null> {
  const summary = await fetchStoreDuesSummary();
  if (!summary || summary.balancePaise <= 0) return null;

  let changed = false;
  const kpis = (model.kpis ?? []).map((k) => {
    if (k.id !== "open") return k;
    changed = true;
    return {
      ...k,
      hint: `${k.hint} · plus ${formatInrCompact(summary.balancePaise)} books/uniform (${summary.studentCount})`,
    };
  });
  if (!changed) return null;
  return { ...model, kpis };
}
