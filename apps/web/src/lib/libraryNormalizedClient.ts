/**
 * Client → server sync for normalized library desk.
 */

import { serialSave } from "@/lib/serialSave";
import type { LibraryState } from "@/lib/library";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";
import {
  recordDeskSyncFailure,
  recordDeskSyncSuccess,
} from "@/lib/deskSyncStatus";
import { confirmDeskDeletes, pendingDeskDeletes, recordDeskDeletion } from "@/lib/deskNamedDeletes";
import { afterStampedDeskSave, captureDeskStamps, stampedDeskBody } from "@/lib/deskStampsClient";
import type { RowConflicts, RowStamps } from "@/lib/rowStampClient";
import { rowFingerprint } from "@/lib/sliceRevClient";

const LIBRARY_DESK = "library";

/** Raise a toast where there is a real browser; a toast must never break a sync. */
function libraryToast(kind: "error" | "info", message: string, durationMs?: number) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  void import("@/components/shell/Toast")
    .then(({ pushToast }) => pushToast({ kind, message, durationMs }))
    .catch(() => undefined);
}

/** Titles, copies or procurement documents the user deleted; the next push deletes them by id. */
export function recordLibraryDeletion(
  table: "library_desk_titles" | "library_desk_copies" | "library_desk_procurement_docs",
  ids: string[],
) {
  recordDeskDeletion(LIBRARY_DESK, table, ids);
}

const META_KEY = "bhb_library_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: LibraryState | null = null;

type DeskMeta = { updatedAt: string; titleCount: number };

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", titleCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", titleCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      titleCount: Number(p.titleCount) || 0,
    };
  } catch {
    return { updatedAt: "", titleCount: 0 };
  }
}

function writeMeta(patch: Partial<DeskMeta> & { updatedAt: string; titleCount: number }) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify({ ...readMeta(), ...patch }));
}

export function libraryNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function libraryReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_LIBRARY_READ_FROM_DB === "true";
}

export function scheduleLibraryDeskSync(state: LibraryState) {
  if (!libraryNormalizedSyncEnabled() || typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (batch) void pushLibraryDeskApi(batch);
  }, DESK_PUSH_DEBOUNCE_MS);
}

const LIBRARY_SLICES = ["titles", "copies", "issues", "procurementDocs"] as const;

/**
 * The e-book shelves as last loaded or saved (fingerprint): they are sent
 * only when the office changed them, and the server merges them by id.
 */
let ebooksBase: number | null = null;

/** One save at a time for this desk — see lib/serialSave. */
function pushLibraryDeskApi(...args: Parameters<typeof pushLibraryDeskApiNow>): ReturnType<typeof pushLibraryDeskApiNow> {
  return serialSave("library", () => pushLibraryDeskApiNow(...args)) as ReturnType<typeof pushLibraryDeskApiNow>;
}

async function pushLibraryDeskApiNow(state: LibraryState) {
  const sentDeletes = pendingDeskDeletes(LIBRARY_DESK);
  const holder = {
    titles: state.titles,
    copies: state.copies,
    issues: state.issues,
    procurementDocs: state.procurementDocs,
    settings: state.settings,
  } as Record<string, unknown>;
  // Only the rows this browser changed, each with the stamp it loaded.
  const sent = stampedDeskBody("library", holder, LIBRARY_SLICES);
  const ebooksHash = rowFingerprint(state.ebooks ?? []);
  const ebooksChanged = (state.ebooks ?? []).length > 0 && ebooksHash !== ebooksBase;
  if (ebooksChanged) sent.body.ebooks = state.ebooks;
  if (!sent.anything && !ebooksChanged && !Object.values(sentDeletes).some((ids) => ids?.length)) return;
  try {
    const res = await fetch("/api/school-data/library-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...sent.body,
        // Deletions are named, never inferred from what this browser lacks.
        deletes: sentDeletes,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      titleCount?: number;
      error?: string;
      stamps?: RowStamps;
      conflicts?: RowConflicts;
      settingsStamp?: string;
      refusedDeletes?: string[];
    } | null;
    if (res.ok && body?.ok && body.refusedDeletes?.length) {
      // The server kept them: they have loan history. Say so, and take the
      // server's desk back so the row reappears instead of looking deleted.
      libraryToast(
        "error",
        `Not deleted — ${body.refusedDeletes!.length} book record(s) have loan history (loans, fines, receipts). Untick Active to retire a title instead.`,
        0,
      );
      void import("@/lib/libraryPersistence").then((m) => m.reloadLibraryFromServer());
    }
    if (res.ok && body?.ok) {
      confirmDeskDeletes(LIBRARY_DESK, sentDeletes);
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        titleCount: body.titleCount ?? state.titles.length,
      });
      afterStampedDeskSave("library", holder, LIBRARY_SLICES, sent, body);
      if (ebooksChanged) ebooksBase = ebooksHash;
    }
    // Record whether this actually landed. A not-ok response is not
    // thrown, so without this it slips past every branch in silence.
    if (res.ok && body?.ok) recordDeskSyncSuccess("library");
    else recordDeskSyncFailure("library", { status: res.status, error: body?.error });
  } catch (e) {
    recordDeskSyncFailure("library", { status: 0, error: e instanceof Error ? e.message : String(e) });
    console.warn("[library-db] desk push error", e);
  }
}

/**
 * Send any save still waiting on the debounce now, and wait for it. The
 * counter calls this before it reloads the desk from the server, so a title
 * typed a moment ago is saved rather than replaced by the server's copy.
 */
export async function flushLibraryDeskSync(): Promise<void> {
  if (!pushTimer) return;
  clearTimeout(pushTimer);
  pushTimer = null;
  const batch = pending;
  pending = null;
  if (batch) await pushLibraryDeskApi(batch);
}

/**
 * The desk exactly as the server holds it — after a counter action changed
 * loans or copies there. null when the read failed (the caller says so; it
 * never treats that as an empty library).
 */
export async function reloadLibraryDeskFromApi() {
  await flushLibraryDeskSync();
  const remote = await fetchLibraryDeskFromApi();
  if (!remote) return null;
  writeMeta({ updatedAt: remote.updatedAt, titleCount: remote.titleCount });
  captureDeskStamps("library", remote.bundle as Record<string, unknown>, LIBRARY_SLICES, remote.stamps, remote.settingsStamp);
  if (Array.isArray(remote.bundle.ebooks)) ebooksBase = rowFingerprint(remote.bundle.ebooks);
  return remote.bundle;
}

export async function fetchLibraryDeskFromApi() {
  if (!libraryNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/library-desk", { cache: "no-store" });
    if (!res.ok) {
      // Say why — "library update pending" reads very differently from an
      // empty library. Never treated as no data.
      const err = (await res.json().catch(() => null)) as { error?: string } | null;
      if (err?.error) libraryToast("error", `Library could not load: ${err.error}`);
      return null;
    }
    const body = (await res.json()) as {
      titles?: LibraryState["titles"];
      copies?: LibraryState["copies"];
      issues?: LibraryState["issues"];
      procurementDocs?: LibraryState["procurementDocs"];
      settings?: LibraryState["settings"];
      ebooks?: LibraryState["ebooks"];
      updatedAt?: string;
      titleCount?: number;
      stamps?: RowStamps;
      settingsStamp?: string;
    };
    if (!Array.isArray(body.titles)) return null;
    return {
      bundle: {
        titles: body.titles,
        copies: body.copies ?? [],
        issues: body.issues ?? [],
        procurementDocs: body.procurementDocs ?? [],
        settings: body.settings ?? {
          maxBooksPerStudent: 2,
          maxBooksPerStaff: 3,
          loanDays: 14,
          finePaisePerDay: 500,
        },
        // Absent = the server could not read them: keep what this page has.
        ...(Array.isArray(body.ebooks) ? { ebooks: body.ebooks } : {}),
      },
      updatedAt: body.updatedAt || "",
      titleCount: body.titleCount ?? body.titles.length,
      stamps: body.stamps,
      settingsStamp: body.settingsStamp,
    };
  } catch {
    return null;
  }
}

export async function hydrateLibraryDeskFromDb(preferDb?: boolean) {
  const remote = await fetchLibraryDeskFromApi();
  const empty = {
    bundle: {
      titles: [] as LibraryState["titles"],
      copies: [] as LibraryState["copies"],
      issues: [] as LibraryState["issues"],
      procurementDocs: [] as LibraryState["procurementDocs"],
      settings: {
        maxBooksPerStudent: 2,
        maxBooksPerStaff: 3,
        loanDays: 14,
        finePaisePerDay: 500,
      },
      ebooks: undefined as LibraryState["ebooks"] | undefined,
    },
    changed: false,
    ok: false,
  };
  if (!remote) return empty;

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    libraryReadFromDbClientEnabled() ||
    meta.titleCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.titleCount > meta.titleCount;

  if (!shouldTake) return { ...empty, bundle: remote.bundle, ok: true };

  writeMeta({ updatedAt: remote.updatedAt, titleCount: remote.titleCount });
  // The rows as the server holds them are the base of the next save.
  captureDeskStamps("library", remote.bundle as Record<string, unknown>, LIBRARY_SLICES, remote.stamps, remote.settingsStamp);
  return { bundle: remote.bundle, changed: true, ok: true };
}
