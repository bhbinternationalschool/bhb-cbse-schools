/**
 * Parity probe: does the row-table reader produce the same masters as the
 * slices?
 *
 * Read-only and diagnostic. It exists because the read-path switch is only
 * safe if the two sources are provably identical, and "I checked the counts"
 * is not that proof — the counts matched at every point during the copy
 * while a field could still have been dropped, renamed or reordered.
 *
 * Delete this route when masters_desk_slices is dropped in Stage 10; until
 * then it is how a drift between the two is found, since both are live.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { fetchMastersDeskFromDb } from "@/lib/mastersNormalized.server";
import {
  diffMastersBundles,
  fetchMastersFromRowTables,
} from "@/lib/mastersRowTables.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "masters", "view");
  if (!auth.ok) return auth.response;

  const [slices, rows] = await Promise.all([
    fetchMastersDeskFromDb(),
    fetchMastersFromRowTables(),
  ]);

  if (!rows.ok) {
    return NextResponse.json(
      { ok: false, error: "row-table read failed" },
      { status: 503 },
    );
  }

  const differences = diffMastersBundles(slices.bundle, rows.bundle);

  return NextResponse.json({
    ok: true,
    identical: differences.length === 0,
    differences,
    counts: Object.fromEntries(
      Object.entries(slices.bundle).map(([k, v]) => [
        k,
        {
          slices: Array.isArray(v) ? v.length : v ? 1 : 0,
          rows: (() => {
            const r = (rows.bundle as Record<string, unknown>)[k];
            return Array.isArray(r) ? r.length : r ? 1 : 0;
          })(),
        },
      ]),
    ),
  });
}
