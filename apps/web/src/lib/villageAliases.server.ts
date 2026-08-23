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
import type {
  VillageAliasCandidate,
  VillageAliasRow,
  VillageAliasStatus,
  VillageAliasSuggestion,
  VillageAliasesResponse,
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
      settlementType: o.settlementType === "town" ? "town" : "village",
      childPool: Number(o.childPool) || 0,
      score: Number(o.score) || 0,
      // Load-bearing for the UI: a skeleton hit is preselected even when its
      // trigram score is near zero, which is exactly the Aayr/Ayar case.
      skeletonMatch: o.skeletonMatch === true,
    };
  });
}

/** The review queue plus the decisions already taken. */
export async function loadAliasWorkspace(
  academicYearCode: string,
): Promise<VillageAliasesResponse> {
  const { sb, tenantId } = await tenant();

  const [candidatesRes, aliasesRes, coverage] = await Promise.all([
    sb.rpc("village_alias_candidates", {
      p_tenant_id: tenantId,
      p_academic_year_code: academicYearCode || null,
      p_limit: CANDIDATE_PAGE,
    }),
    sb.rpc("village_alias_list", { p_tenant_id: tenantId }),
    fetchLeadCoverage(sb, tenantId, academicYearCode),
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
    settlementType: r.settlement_type === "town" ? "town" : "village",
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
