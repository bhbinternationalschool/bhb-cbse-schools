/**
 * Admissions → Village market: parent contacts for ad targeting.
 *
 * Separate from the dashboard payload on purpose. The grid re-renders on
 * every tab switch and filter change; parents' phone numbers have no business
 * riding along with it. They are fetched only when somebody presses Export,
 * behind `admissions:edit`, and the export is written to the audit log.
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import { getServerTenantContext } from "@/lib/serverTenant";
import type { VillageContactRow, VillageContactsResponse } from "@/lib/villageMarket";

const LOG = "[villageContacts]";

/** A whole-district export is ~1,292 settlements; cap it deliberately. */
export const MAX_EXPORT_SETTLEMENTS = 1500;

export class VillageContactsError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "VillageContactsError";
    this.status = status;
  }
}

export type ContactsQuery = {
  blocks: string[];
  settlementType: "all" | "village" | "town";
  minChildPool: number;
  /** Skip settlements with no reachable parent — they add empty rows. */
  onlyWithContacts: boolean;
  academicYearCode: string;
};

export function parseContactsQuery(params: URLSearchParams): ContactsQuery {
  const rawType = (params.get("settlementType") || "all").trim().toLowerCase();
  if (rawType !== "all" && rawType !== "village" && rawType !== "town") {
    throw new VillageContactsError("settlementType must be all, village or town");
  }
  const minRaw = Number(params.get("minChildPool") || 0);
  if (!Number.isFinite(minRaw) || minRaw < 0) {
    throw new VillageContactsError("minChildPool must be a non-negative number");
  }
  return {
    blocks: (params.get("blocks") || "").split(",").map((b) => b.trim()).filter(Boolean),
    settlementType: rawType,
    minChildPool: Math.round(minRaw),
    onlyWithContacts: params.get("onlyWithContacts") !== "false",
    academicYearCode: (params.get("academicYearCode") || "").trim(),
  };
}

type Sb = NonNullable<ReturnType<typeof createServiceSupabase>>;

/**
 * Settlements matching the filter, each with its distinct parent numbers.
 *
 * Attribution is the same single-owner rule the dashboard counts use, so an
 * exported audience matches the village card it was exported from.
 */
export async function loadVillageContacts(
  query: ContactsQuery,
): Promise<VillageContactsResponse> {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    throw new VillageContactsError("Census database is not reachable.", 503);
  }
  const sb = ctx.sb as Sb;
  const tenantId = ctx.tenantId;

  let q = sb
    .from("village_demographics")
    .select(
      "id, village_name, block_name, latitude, longitude, estimated_current_child_pop",
    )
    .eq("tenant_id", tenantId);

  if (query.blocks.length) q = q.in("block_name", query.blocks);
  if (query.settlementType !== "all") q = q.eq("settlement_type", query.settlementType);
  if (query.minChildPool > 0) {
    q = q.gte("estimated_current_child_pop", query.minChildPool);
  }

  const { data, error } = await q
    .order("estimated_current_child_pop", { ascending: false })
    .range(0, MAX_EXPORT_SETTLEMENTS - 1);

  if (error) {
    throw new VillageContactsError(`Could not read settlements: ${error.message}`, 502);
  }

  const settlements = (data as unknown as {
    id: string;
    village_name: string;
    block_name: string;
    latitude: number | null;
    longitude: number | null;
    estimated_current_child_pop: number;
  }[] | null) ?? [];

  if (!settlements.length) {
    return { ok: true, rows: [], totals: { settlements: 0, contacts: 0, withCoordinates: 0 } };
  }

  const { data: contactData, error: contactError } = await sb.rpc(
    "village_lead_contacts",
    {
      p_tenant_id: tenantId,
      p_village_ids: settlements.map((s) => s.id),
      p_academic_year_code: query.academicYearCode || null,
    },
  );
  if (contactError) {
    throw new VillageContactsError(
      `Could not read contacts: ${contactError.message}`,
      502,
    );
  }

  const byVillage = new Map<string, { phones: string[]; leadCount: number }>();
  for (const r of (contactData as Record<string, unknown>[] | null) ?? []) {
    byVillage.set(String(r.village_id), {
      phones: Array.isArray(r.phones) ? (r.phones as string[]) : [],
      leadCount: Number(r.lead_count) || 0,
    });
  }

  let rows: VillageContactRow[] = settlements.map((s) => {
    const hit = byVillage.get(s.id);
    return {
      villageId: s.id,
      villageName: s.village_name,
      blockName: s.block_name,
      latitude: typeof s.latitude === "number" ? s.latitude : null,
      longitude: typeof s.longitude === "number" ? s.longitude : null,
      childPool: Number(s.estimated_current_child_pop) || 0,
      leadCount: hit?.leadCount ?? 0,
      phones: hit?.phones ?? [],
    };
  });

  if (query.onlyWithContacts) rows = rows.filter((r) => r.phones.length > 0);

  const contacts = rows.reduce((n, r) => n + r.phones.length, 0);
  const withCoordinates = rows.filter((r) => r.latitude !== null && r.longitude !== null).length;

  // Counts only — never the numbers themselves.
  console.info(
    `${LOG} export blocks=${query.blocks.join("|") || "all"} settlements=${rows.length} contacts=${contacts} withCoords=${withCoordinates}`,
  );

  return {
    ok: true,
    rows,
    totals: { settlements: rows.length, contacts, withCoordinates },
  };
}
