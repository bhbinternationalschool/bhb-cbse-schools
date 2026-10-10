/**
 * GET /api/admissions/city-wards
 *
 * The official 2022 Nagar Nigam ward directory: all 100 wards with the
 * mohallas/colonies their gazetted extents name. Read-only reference data
 * for the Village market's city view — it tells the office WHICH ward a
 * mohalla belongs to, and deliberately carries no population figures,
 * because the 2022 wards have no official crosswalk to the census-2011
 * wards that do.
 *
 * Source: city_ward_directory, seeded by scripts/seed-city-ward-directory.ts
 * from UP Govt notification 3474/9-1-2022-55Pari/22.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import type { CityWardDirectoryWard } from "@/lib/villageMarket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireStaffPermission(request, "admissions", "view");
  if (!auth.ok) return auth.response;

  const tenant = await getServerTenantContext();
  if (!tenant) {
    return NextResponse.json(
      { ok: false, error: "Ward directory is not reachable." },
      { status: 503 },
    );
  }

  const { data, error } = await tenant.sb
    .from("city_ward_directory")
    .select("ward_no, ward_name, ward_name_hi, locality")
    .eq("tenant_id", tenant.tenantId)
    .order("ward_no", { ascending: true })
    .order("locality", { ascending: true })
    .range(0, 1999);

  if (error) {
    console.error(`[city-wards] read failed: ${error.message}`);
    return NextResponse.json(
      { ok: false, error: `Could not read the ward directory: ${error.message}` },
      { status: 502 },
    );
  }

  const byWard = new Map<number, CityWardDirectoryWard>();
  let totalLocalities = 0;
  for (const r of (data as Record<string, unknown>[] | null) ?? []) {
    const wardNo = Number(r.ward_no) || 0;
    if (!wardNo) continue;
    let ward = byWard.get(wardNo);
    if (!ward) {
      ward = {
        wardNo,
        wardName: String(r.ward_name ?? ""),
        wardNameHi: String(r.ward_name_hi ?? ""),
        localities: [],
      };
      byWard.set(wardNo, ward);
    }
    const locality = String(r.locality ?? "").trim();
    // The ward's own name is seeded as a locality for matching; repeating it
    // in the display list would read as a mistake.
    if (locality && locality.toLowerCase() !== ward.wardName.toLowerCase()) {
      ward.localities.push(locality);
      totalLocalities += 1;
    }
  }

  return NextResponse.json(
    {
      ok: true,
      wards: [...byWard.values()].sort((a, b) => a.wardNo - b.wardNo),
      totalLocalities,
      source:
        "Nagar Nigam Varanasi delimitation, UP Govt notification 3474/9-1-2022-55Pari/22 (10 Oct 2022)",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
