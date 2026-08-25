/**
 * Admissions → Village market: spelling aliases, server side.
 *
 * Closes the gap fuzzy matching cannot. On 2026-08-24, 267 of 919 leads named
 * a locality no census village matched, so every penetration figure was a
 * floor. `similarity('Ayar','Aayr')` is 0.111 — no threshold catches that
 * without also matching Akla to Koila and crediting leads to a village nobody
 * visited. So a person decides once per spelling, and the decision sticks.
 *
 * Everything downstream — lead counts, block rollups, coverage — resolves
 * through `village_resolve_owner`, so one confirmation fixes all of them at
 * once. There is no second cache to invalidate.
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchLeadCoverage } from "@/lib/villageMarket.server";
import {
  settlementTypeOf,
  type VillageAliasCandidate,
  type VillageAliasRow,
  type VillageAliasStatus,
  type VillageAliasSuggestion,
  type VillageAliasesResponse,
} from "@/lib/villageMarket";

const LOG = "[villageAliases]";

/** How many unresolved spellings one page of the review queue shows. */
export const CANDIDATE_PAGE = 50;

export class VillageAliasError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "VillageAliasError";
    this.status = status;
  }
}

type Sb = NonNullable<ReturnType<typeof createServiceSupabase>>;

async function tenant(): Promise<{ sb: Sb; tenantId: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    throw new VillageAliasError(
      "Census database is not reachable, so spellings cannot be reviewed.",
      503,
    );
  }
  return ctx as { sb: Sb; tenantId: string };
}

function toSuggestions(raw: unknown): VillageAliasSuggestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => {
    const o = s as Record<string, unknown>;
    return {
      villageId: String(o.villageId ?? ""),
      villageName: String(o.villageName ?? ""),
      blockName: String(o.blockName ?? ""),
      settlementType: settlementTypeOf(String(o.settlementType ?? "")),
      childPool: Number(o.childPool) || 0,
      score: Number(o.score) || 0,
      // Load-bearing for the UI: a skeleton hit is preselected even when its
      // trigram score is near zero, which is exactly the Aayr/Ayar case.
      skeletonMatch: o.skeletonMatch === true,
    };
  });
}

/**
 * The city holding settlement — where a confirmed Varanasi City locality
 * lands. Population zero by design: it puts the lead in the city block
 * without inventing a ward-level pool. Null when the row is not seeded,
 * in which case city suggestions are simply not offered.
 */
async function fetchCityHoldingSettlement(
  sb: Sb,
  tenantId: string,
): Promise<{ id: string; villageName: string; blockName: string } | null> {
  const { data, error } = await sb
    .from("village_demographics")
    .select("id, village_name, block_name")
    .eq("tenant_id", tenantId)
    .eq("census_code", "VNN-PENDING")
    .maybeSingle();
  if (error || !data) {
    if (error) console.warn(`${LOG} city holding row lookup failed: ${error.message}`);
    return null;
  }
  return {
    id: String(data.id),
    villageName: String(data.village_name),
    blockName: String(data.block_name),
  };
}

/**
 * Check unresolved spellings against the official 2022 Nagar Nigam locality
 * directory. A hit means "this is a city mohalla" — the one suggestion the
 * census candidates can never provide, because mohallas are not census
 * settlements. Failure here degrades to no city suggestions, never an error:
 * the census suggestions still render.
 */
async function fetchCityWardMatches(
  sb: Sb,
  tenantId: string,
  localities: string[],
): Promise<Map<string, { wardNo: number | null; wardName: string; matchedLocality: string; score: number }>> {
  const out = new Map<
    string,
    { wardNo: number | null; wardName: string; matchedLocality: string; score: number }
  >();
  if (!localities.length) return out;

  const { data, error } = await sb.rpc("city_ward_directory_match", {
    p_tenant_id: tenantId,
    p_localities: localities,
  });
  if (error) {
    console.warn(`${LOG} city_ward_directory_match failed: ${error.message}`);
    return out;
  }
  for (const r of (data as Record<string, unknown>[] | null) ?? []) {
    const ambiguous = (Number(r.ambiguous_wards) || 0) > 1;
    out.set(String(r.locality ?? ""), {
      // Several wards share this locality name — naming one would be a guess.
      wardNo: ambiguous ? null : Number(r.ward_no) || null,
      wardName: ambiguous ? "" : String(r.ward_name ?? ""),
      matchedLocality: String(r.matched_locality ?? ""),
      score: Number(r.score) || 0,
    });
  }
  return out;
}

/** The review queue plus the decisions already taken. */
export async function loadAliasWorkspace(
  academicYearCode: string,
): Promise<VillageAliasesResponse> {
  const { sb, tenantId } = await tenant();

  const [candidatesRes, aliasesRes, coverage, cityHolding] = await Promise.all([
    sb.rpc("village_alias_candidates", {
      p_tenant_id: tenantId,
      p_academic_year_code: academicYearCode || null,
      p_limit: CANDIDATE_PAGE,
    }),
    sb.rpc("village_alias_list", { p_tenant_id: tenantId }),
    fetchLeadCoverage(sb, tenantId, academicYearCode),
    fetchCityHoldingSettlement(sb, tenantId),
  ]);

  if (candidatesRes.error) {
    throw new VillageAliasError(
      `Could not read the review queue: ${candidatesRes.error.message}`,
      502,
    );
  }
  if (aliasesRes.error) {
    throw new VillageAliasError(
      `Could not read saved spellings: ${aliasesRes.error.message}`,
      502,
    );
  }

  const rows = (candidatesRes.data as Record<string, unknown>[] | null) ?? [];
  const candidates: VillageAliasCandidate[] = rows.map((r) => ({
    locality: String(r.locality ?? ""),
    leadCount: Number(r.lead_count) || 0,
    enrolledCount: Number(r.enrolled_count) || 0,
    suggestions: toSuggestions(r.suggestions),
  }));

  // The queue only holds spellings NO census settlement matched, so a
  // directory hit is the strongest signal on the row — it goes first and is
  // what the row preselects.
  if (cityHolding && candidates.length) {
    const matches = await fetchCityWardMatches(
      sb,
      tenantId,
      candidates.map((c) => c.locality),
    );
    for (const c of candidates) {
      const m = matches.get(c.locality);
      if (!m) continue;
      c.suggestions = [
        {
          villageId: cityHolding.id,
          villageName: cityHolding.villageName,
          blockName: cityHolding.blockName,
          settlementType: "ward",
          childPool: 0,
          score: m.score,
          cityWard: {
            wardNo: m.wardNo,
            wardName: m.wardName,
            matchedLocality: m.matchedLocality,
          },
        },
        ...c.suggestions,
      ];
    }
  }

  const aliases: VillageAliasRow[] = (
    (aliasesRes.data as Record<string, unknown>[] | null) ?? []
  ).map((r) => ({
    id: String(r.id ?? ""),
    alias: String(r.alias ?? ""),
    status: r.status === "ignored" ? "ignored" : "confirmed",
    villageId: r.village_id ? String(r.village_id) : null,
    villageName: String(r.village_name ?? ""),
    blockName: String(r.block_name ?? ""),
    leadCountAtConfirm: Number(r.lead_count_at_confirm) || 0,
    note: String(r.note ?? ""),
    confirmedBy: String(r.confirmed_by ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  }));

  return {
    ok: true,
    candidates,
    aliases,
    coverage,
    truncated: candidates.length >= CANDIDATE_PAGE,
  };
}

/**
 * Free-text village lookup for the review screen.
 *
 * The ranked suggestions cover most spellings, but not all — "Derwa" and
 * "Chandmari" have no convincing census neighbour. Without a way to search,
 * those rows can only ever be marked "not a village", which would quietly
 * discard real leads.
 */
export async function searchVillages(
  query: string,
  limit = 20,
): Promise<VillageAliasSuggestion[]> {
  const q = (query || "").trim();
  if (q.length < 2) return [];

  const { sb, tenantId } = await tenant();
  const { data, error } = await sb.rpc("village_search", {
    p_tenant_id: tenantId,
    p_query: q,
    p_limit: limit,
  });
  if (error) {
    console.warn(`${LOG} search failed q="${q}": ${error.message}`);
    throw new VillageAliasError(`Could not search villages: ${error.message}`, 502);
  }
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    villageId: String(r.village_id ?? ""),
    villageName: String(r.village_name ?? ""),
    blockName: String(r.block_name ?? ""),
    settlementType: settlementTypeOf(String(r.settlement_type ?? "")),
    childPool: Number(r.child_pool) || 0,
    score: Number(r.score) || 0,
  }));
}

export type SaveAliasInput = {
  alias: string;
  status: VillageAliasStatus;
  /** Required when status is "confirmed"; ignored otherwise. */
  villageId?: string | null;
  leadCount?: number;
  note?: string;
};

/**
 * Record one decision.
 *
 * Upsert on the folded alias key, so re-deciding a spelling corrects it
 * rather than colliding — the office changing its mind is a normal event,
 * not an error.
 */
export async function saveAlias(
  input: SaveAliasInput,
  actor: string,
): Promise<VillageAliasRow> {
  const alias = (input.alias || "").trim();
  if (!alias) throw new VillageAliasError("A spelling is required.");
  if (alias.length > 120) throw new VillageAliasError("That spelling is too long.");

  const status: VillageAliasStatus = input.status === "ignored" ? "ignored" : "confirmed";
  const villageId = status === "confirmed" ? (input.villageId || "").trim() : "";

  if (status === "confirmed" && !villageId) {
    throw new VillageAliasError("Pick the village this spelling means.");
  }

  const { sb, tenantId } = await tenant();

  // Verify the target belongs to this tenant before writing. The check
  // constraint enforces shape, not ownership.
  if (status === "confirmed") {
    const { data, error } = await sb
      .from("village_demographics")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", villageId)
      .maybeSingle();
    if (error) {
      throw new VillageAliasError(`Could not verify the village: ${error.message}`, 502);
    }
    if (!data) throw new VillageAliasError("That village is not on file.", 404);
  }

  const { data, error } = await sb
    .from("village_name_aliases")
    .upsert(
      {
        tenant_id: tenantId,
        alias,
        village_id: status === "confirmed" ? villageId : null,
        status,
        lead_count_at_confirm: Math.max(0, Math.round(input.leadCount ?? 0)),
        note: (input.note || "").slice(0, 500),
        confirmed_by: actor,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,alias_key" },
    )
    .select("id, alias, status, village_id, lead_count_at_confirm, note, confirmed_by, updated_at")
    .single();

  if (error || !data) {
    console.error(`${LOG} save failed alias="${alias}": ${error?.message}`);
    throw new VillageAliasError(
      `Could not save that spelling: ${error?.message ?? "unknown error"}`,
      502,
    );
  }

  console.info(
    `${LOG} ${status} alias="${alias}" village=${villageId || "-"} by=${actor}`,
  );

  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    alias: String(row.alias),
    status,
    villageId: row.village_id ? String(row.village_id) : null,
    villageName: "",
    blockName: "",
    leadCountAtConfirm: Number(row.lead_count_at_confirm) || 0,
    note: String(row.note ?? ""),
    confirmedBy: String(row.confirmed_by ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

/** Undo a decision — the spelling returns to the review queue. */
export async function deleteAlias(id: string, actor: string): Promise<void> {
  const aliasId = (id || "").trim();
  if (!aliasId) throw new VillageAliasError("Which spelling?");

  const { sb, tenantId } = await tenant();
  const { error } = await sb
    .from("village_name_aliases")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", aliasId);

  if (error) {
    console.error(`${LOG} delete failed id=${aliasId}: ${error.message}`);
    throw new VillageAliasError(`Could not remove that spelling: ${error.message}`, 502);
  }
  console.info(`${LOG} removed alias id=${aliasId} by=${actor}`);
}
