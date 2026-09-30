import "server-only";

/**
 * The NCERT / CBSE class-wise subject lists from DIKSHA: the weekly sync,
 * the read the Masters screen uses, and the school's matches and decisions.
 * Rules and parsing are in ncfOfficial.ts; tables in migration
 * 20260930170000_ncf_official_subjects.sql.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import {
  NCF_FRAMEWORKS,
  diffOfficial,
  frameworkUrl,
  officialKey,
  parseFramework,
  type NcfBoard,
  type NcfMapping,
  type OfficialChange,
  type StoredOfficial,
} from "@/lib/ncfOfficial";

const FETCH_TIMEOUT_MS = 20_000;

type OfficialRow = {
  board: NcfBoard;
  grade: string;
  subject: string;
  first_seen_at: string;
  last_seen_at: string;
  removed_at: string | null;
};

export type NcfSyncResult = {
  dryRun: boolean;
  boards: {
    board: NcfBoard;
    ok: boolean;
    error?: string;
    grades: number;
    subjects: number;
    baseline: boolean;
    added: number;
    removed: number;
  }[];
};

async function readFramework(frameworkId: string): Promise<Map<string, string[]>> {
  const res = await fetch(frameworkUrl(frameworkId), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`DIKSHA framework ${frameworkId}: HTTP ${res.status}`);
  const parsed = parseFramework(await res.json());
  if (!parsed) throw new Error(`DIKSHA framework ${frameworkId}: unrecognised response`);
  return parsed;
}

async function readStored(): Promise<{ ctx: NonNullable<Awaited<ReturnType<typeof getServerTenantContext>>>; rows: OfficialRow[] }> {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("No database: the NCF subject lists cannot be read");
  const read = await fetchAllPages<OfficialRow>((from, to) =>
    ctx.sb
      .from("ncf_official_subjects")
      .select("board, grade, subject, first_seen_at, last_seen_at, removed_at")
      .eq("tenant_id", ctx.tenantId)
      .order("board")
      .order("grade")
      .order("subject")
      .range(from, to),
  );
  // Not knowing what is stored must never read as "nothing stored": every
  // subject would come back as a baseline and real changes would be lost.
  if (read.error) throw new Error(`ncf_official_subjects not readable: ${read.error}`);
  return { ctx, rows: read.rows };
}

/**
 * Read both boards from DIKSHA and bring the stored lists up to date.
 * A board DIKSHA fails for is reported and left exactly as stored.
 */
export async function syncNcfOfficial(opts: { dryRun?: boolean } = {}): Promise<NcfSyncResult> {
  const dryRun = !!opts.dryRun;
  const { ctx, rows } = await readStored();
  const stored: StoredOfficial[] = rows.map((r) => ({
    board: r.board,
    grade: r.grade,
    subject: r.subject,
    removedAt: r.removed_at,
  }));
  const result: NcfSyncResult = { dryRun, boards: [] };
  const now = new Date().toISOString();

  for (const fw of NCF_FRAMEWORKS) {
    let fresh: Map<string, string[]>;
    try {
      fresh = await readFramework(fw.frameworkId);
    } catch (e) {
      result.boards.push({
        board: fw.board,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        grades: 0,
        subjects: 0,
        baseline: false,
        added: 0,
        removed: 0,
      });
      continue;
    }
    const { changes, baseline } = diffOfficial(fw.board, stored, fresh);
    const subjects = [...fresh.values()].reduce((n, l) => n + l.length, 0);
    const summary = {
      board: fw.board,
      ok: true,
      grades: fresh.size,
      subjects,
      baseline,
      added: changes.filter((c) => c.kind === "added").length,
      removed: changes.filter((c) => c.kind === "removed").length,
    };

    if (!dryRun) {
      const present = [...fresh.entries()].flatMap(([grade, list]) =>
        list.map((subject) => ({
          tenant_id: ctx.tenantId,
          board: fw.board,
          grade,
          subject,
          last_seen_at: now,
          removed_at: null,
        })),
      );
      for (let i = 0; i < present.length; i += 500) {
        const { error } = await ctx.sb
          .from("ncf_official_subjects")
          .upsert(present.slice(i, i + 500), { onConflict: "tenant_id,board,grade,subject" });
        if (error) throw new Error(`ncf_official_subjects upsert (${fw.board}): ${error.message}`);
      }
      for (const c of changes.filter((x) => x.kind === "removed")) {
        const { error } = await ctx.sb
          .from("ncf_official_subjects")
          .update({ removed_at: now })
          .eq("tenant_id", ctx.tenantId)
          .eq("board", c.board)
          .eq("grade", c.grade)
          .eq("subject", c.subject);
        if (error) throw new Error(`ncf_official_subjects retire: ${error.message}`);
      }
      await recordChanges(ctx, changes);
    }
    result.boards.push(summary);
  }
  return result;
}

async function recordChanges(
  ctx: NonNullable<Awaited<ReturnType<typeof getServerTenantContext>>>,
  changes: OfficialChange[],
): Promise<void> {
  if (changes.length === 0) return;
  // A change already waiting for the office is not queued twice.
  const { data: pending, error: readErr } = await ctx.sb
    .from("ncf_official_changes")
    .select("board, grade, subject, kind")
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "pending");
  if (readErr) throw new Error(`ncf_official_changes not readable: ${readErr.message}`);
  const waiting = new Set(
    (pending ?? []).map((p) => `${p.board}|${p.grade}|${officialKey(p.subject)}|${p.kind}`),
  );
  const fresh = changes
    .filter((c) => !waiting.has(`${c.board}|${c.grade}|${officialKey(c.subject)}|${c.kind}`))
    .map((c) => ({ tenant_id: ctx.tenantId, board: c.board, grade: c.grade, subject: c.subject, kind: c.kind }));
  if (fresh.length === 0) return;
  const { error } = await ctx.sb.from("ncf_official_changes").insert(fresh);
  if (error) throw new Error(`ncf_official_changes insert: ${error.message}`);
}

/* ── The Masters screen ──────────────────────────────────────────────── */

export type NcfOfficialView = {
  /** board → grade → subjects DIKSHA lists now. */
  lists: Record<NcfBoard, Record<string, string[]>>;
  changes: {
    id: string;
    board: NcfBoard;
    grade: string;
    subject: string;
    kind: "added" | "removed";
    detectedAt: string;
  }[];
  mappings: NcfMapping[];
  /** Last time any list was confirmed against DIKSHA; null = never synced. */
  lastSyncAt: string | null;
};

export async function loadNcfOfficialView(): Promise<NcfOfficialView> {
  const { ctx, rows } = await readStored();
  const lists: NcfOfficialView["lists"] = { NCERT: {}, CBSE: {} };
  let lastSyncAt: string | null = null;
  for (const r of rows) {
    if (!lastSyncAt || r.last_seen_at > lastSyncAt) lastSyncAt = r.last_seen_at;
    if (r.removed_at) continue;
    (lists[r.board][r.grade] ??= []).push(r.subject);
  }
  const [changes, mappings] = await Promise.all([
    ctx.sb
      .from("ncf_official_changes")
      .select("id, board, grade, subject, kind, detected_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("status", "pending")
      .order("detected_at", { ascending: false })
      .limit(200),
    ctx.sb.from("ncf_subject_mappings").select("subject_key, school_subject_id").eq("tenant_id", ctx.tenantId),
  ]);
  if (changes.error) throw new Error(`ncf_official_changes not readable: ${changes.error.message}`);
  if (mappings.error) throw new Error(`ncf_subject_mappings not readable: ${mappings.error.message}`);
  return {
    lists,
    changes: (changes.data ?? []).map((c) => ({
      id: String(c.id),
      board: c.board as NcfBoard,
      grade: String(c.grade),
      subject: String(c.subject),
      kind: c.kind === "removed" ? "removed" : "added",
      detectedAt: String(c.detected_at),
    })),
    mappings: (mappings.data ?? []).map((m) => ({
      subjectKey: String(m.subject_key),
      schoolSubjectId: String(m.school_subject_id),
    })),
    lastSyncAt,
  };
}

/** Save the school's matches (null school subject = forget the match). */
export async function saveNcfMappings(
  list: { subjectKey: string; schoolSubjectId: string | null }[],
  by: string,
): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("No database");
  const now = new Date().toISOString();
  const keep = list.filter((m) => m.schoolSubjectId);
  const drop = list.filter((m) => !m.schoolSubjectId).map((m) => officialKey(m.subjectKey));
  if (keep.length) {
    const { error } = await ctx.sb.from("ncf_subject_mappings").upsert(
      keep.map((m) => ({
        tenant_id: ctx.tenantId,
        subject_key: officialKey(m.subjectKey),
        school_subject_id: m.schoolSubjectId,
        updated_at: now,
        updated_by: by,
      })),
      { onConflict: "tenant_id,subject_key" },
    );
    if (error) throw new Error(`ncf_subject_mappings save: ${error.message}`);
  }
  if (drop.length) {
    const { error } = await ctx.sb
      .from("ncf_subject_mappings")
      .delete()
      .eq("tenant_id", ctx.tenantId)
      .in("subject_key", drop);
    if (error) throw new Error(`ncf_subject_mappings forget: ${error.message}`);
  }
}

/** The office acted on a change (done) or chose not to (dismissed). */
export async function decideNcfChange(id: string, status: "done" | "dismissed", by: string): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) throw new Error("No database");
  const { error } = await ctx.sb
    .from("ncf_official_changes")
    .update({ status, decided_at: new Date().toISOString(), decided_by: by })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw new Error(`ncf_official_changes decide: ${error.message}`);
}
