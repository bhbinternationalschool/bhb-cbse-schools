/**
 * Client → server sync for normalized exam desk.
 */

import type { ExamsState } from "@/lib/exams";
import { defaultExamPolicy } from "@/lib/exams";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";
import {
  recordDeskSyncFailure,
  recordDeskSyncSuccess,
} from "@/lib/deskSyncStatus";
import { confirmDeskDeletes, pendingDeskDeletes, recordDeskDeletion } from "@/lib/deskNamedDeletes";
import { afterStampedDeskSave, captureDeskStamps, stampedDeskBody } from "@/lib/deskStampsClient";
import type { RowConflicts, RowStamps } from "@/lib/rowStampClient";

const EXAMS_SLICES = ["terms", "subjects", "dateSheet", "promotions", "rooms", "seating"] as const;

const EXAMS_DESK = "exams";

/** Exam setup rows the user deleted; the next push deletes them by id. */
export function recordExamsDeletion(
  table: "exam_desk_terms" | "exam_desk_date_sheet" | "exam_desk_rooms" | "exam_desk_seating",
  ids: string[],
) {
  recordDeskDeletion(EXAMS_DESK, table, ids);
}

const META_KEY = "bhb_exams_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: ExamsState | null = null;

type DeskMeta = {
  updatedAt: string;
  sheetCount: number;
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", sheetCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", sheetCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      sheetCount: Number(p.sheetCount) || 0,
    };
  } catch {
    return { updatedAt: "", sheetCount: 0 };
  }
}

function writeMeta(patch: Partial<DeskMeta> & { updatedAt: string; sheetCount: number }) {
  if (typeof window === "undefined") return;
  const prev = readMeta();
  localStorage.setItem(META_KEY, JSON.stringify({ ...prev, ...patch }));
}

export function examsNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function examsReadFromDbClientEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_EXAMS_READ_FROM_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function scheduleExamsDeskSync(state: ExamsState) {
  if (!examsNormalizedSyncEnabled()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (!batch) return;
    void pushExamsDeskApi(batch);
  }, DESK_PUSH_DEBOUNCE_MS);
}

async function pushExamsDeskApi(state: ExamsState) {
  const sentDeletes = pendingDeskDeletes(EXAMS_DESK);
  // Setup only. Sheets go one at a time through examsSheetSync.ts — sending
  // them here replaced (and pruned) every sheet on the server. Only the rows
  // this browser changed travel, each with the stamp it loaded; rooms and
  // seating plans now travel too (they never did before 10 Oct 2026).
  const holder = {
    terms: state.terms,
    subjects: state.subjects,
    dateSheet: state.dateSheet,
    promotions: state.promotions,
    rooms: state.rooms ?? [],
    seating: state.seating ?? [],
    policy: state.policy,
  } as Record<string, unknown>;
  const sent = stampedDeskBody("exams", holder, EXAMS_SLICES, "policy");
  if (!sent.anything && !Object.values(sentDeletes).some((ids) => ids?.length)) return;
  try {
    const res = await fetch("/api/school-data/exams-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Deletions are named, never inferred from what this browser lacks.
      body: JSON.stringify({ ...sent.body, deletes: sentDeletes }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      sheetCount?: number;
      error?: string;
      stamps?: RowStamps;
      conflicts?: RowConflicts;
      settingsStamp?: string;
    } | null;
    if (res.ok && body?.ok) {
      confirmDeskDeletes(EXAMS_DESK, sentDeletes);
      afterStampedDeskSave("exams", holder, EXAMS_SLICES, sent, body, "policy");
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        sheetCount: body.sheetCount ?? state.sheets.length,
      });
    } else if (!res.ok) {
      console.warn("[exams-db] desk push failed", body?.error || res.status);
    }
    // Record whether this actually landed. A not-ok response is not
    // thrown, so without this it slips past every branch in silence.
    if (res.ok && body?.ok) recordDeskSyncSuccess("exams");
    else recordDeskSyncFailure("exams", { status: res.status, error: body?.error });
  } catch (e) {
    recordDeskSyncFailure("exams", { status: 0, error: e instanceof Error ? e.message : String(e) });
    console.warn("[exams-db] desk push error", e);
  }
}

export async function fetchExamsDeskFromApi(): Promise<{
  bundle: {
    terms: ExamsState["terms"];
    subjects: ExamsState["subjects"];
    dateSheet: ExamsState["dateSheet"];
    sheets: ExamsState["sheets"];
    policy: ExamsState["policy"];
    promotions: ExamsState["promotions"];
    rooms: ExamsState["rooms"];
    seating: ExamsState["seating"];
  };
  updatedAt: string;
  sheetCount: number;
  stamps?: RowStamps;
  policyStamp?: string;
} | null> {
  if (!examsNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/exams-desk", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      terms?: ExamsState["terms"];
      subjects?: ExamsState["subjects"];
      dateSheet?: ExamsState["dateSheet"];
      sheets?: ExamsState["sheets"];
      policy?: ExamsState["policy"];
      promotions?: ExamsState["promotions"];
      rooms?: ExamsState["rooms"];
      seating?: ExamsState["seating"];
      updatedAt?: string;
      sheetCount?: number;
      stamps?: RowStamps;
      policyStamp?: string;
    };
    if (!Array.isArray(body.sheets)) return null;
    return {
      bundle: {
        terms: body.terms ?? [],
        subjects: body.subjects ?? [],
        dateSheet: body.dateSheet ?? [],
        sheets: body.sheets,
        policy: body.policy!,
        promotions: body.promotions ?? [],
        rooms: body.rooms ?? [],
        seating: body.seating ?? [],
      },
      updatedAt: body.updatedAt || "",
      sheetCount: body.sheetCount ?? body.sheets.length,
      stamps: body.stamps,
      policyStamp: body.policyStamp,
    };
  } catch {
    return null;
  }
}

export async function hydrateExamsDeskFromDb(
  preferDb?: boolean,
): Promise<{ bundle: ExamsState; changed: boolean; ok: boolean }> {
  const remote = await fetchExamsDeskFromApi();
  if (!remote) {
    return {
      bundle: {
        version: 1,
        terms: [],
        subjects: [],
        dateSheet: [],
        sheets: [],
        policy: defaultExamPolicy(),
        promotions: [],
        rooms: [],
        seating: [],
      },
      changed: false,
      ok: false,
    };
  }

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    examsReadFromDbClientEnabled() ||
    meta.sheetCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.sheetCount > meta.sheetCount;

  if (!shouldTake) {
    return {
      bundle: {
        version: 1,
        terms: [],
        subjects: [],
        dateSheet: [],
        sheets: [],
        policy: defaultExamPolicy(),
        promotions: [],
        rooms: [],
        seating: [],
      },
      changed: false,
      ok: true,
    };
  }

  writeMeta({
    updatedAt: remote.updatedAt,
    sheetCount: remote.sheetCount,
  });
  // The setup as the server holds it is the base of the next save.
  captureDeskStamps("exams", remote.bundle as Record<string, unknown>, EXAMS_SLICES, remote.stamps, remote.policyStamp, "policy");

  return {
    bundle: {
      version: 1,
      ...remote.bundle,
    },
    changed: true,
    ok: true,
  };
}
