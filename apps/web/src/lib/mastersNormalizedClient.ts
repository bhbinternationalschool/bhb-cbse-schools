/**
 * Client → server sync for masters desk slices.
 */

import type { MastersState } from "@/lib/masters";
import { emptyMastersShell } from "@/lib/masters";
import { isSupabaseConfigured } from "@/lib/supabase/client";

const META_KEY = "bhb_masters_desk_db_meta_v1";
const LOCAL_EDIT_META_KEY = "bhb_masters_mirror_meta_v1";
/** Mirrors STORAGE_KEY in masters.ts — read-only, to detect an empty desk. */
const LOCAL_STATE_KEY = "bhb_masters_v5";

/**
 * True when this browser holds no classes at all.
 *
 * Emptiness is not an edit. A desk with zero classes never hydrated, or was
 * wiped — either way there is nothing in it worth defending against the
 * server, and treating it as a local edit is what froze devices: `shouldTake`
 * requires `remoteAt > localEditAt`, hydration itself stamps `localEditAt`, so
 * an empty desk with a recent stamp refuses the server's data forever. The
 * device then pushes its emptiness, the server refuses it (`rejected wipe push
 * stored=15 incoming=0`), and nothing ever gets better. Clearing site data was
 * the only cure, which is exactly the repair step this migration exists to
 * abolish.
 *
 * Safe because it can only ever pull data IN. And there is no legitimate
 * "I deleted every class" state to protect: guardMastersOverwrite already
 * refuses those pushes server-side, so such a state can never be authoritative.
 * This is the client-side half of a rule the server has enforced all along.
 *
 * Unreadable or absent local state counts as empty — a desk that cannot be
 * parsed is not one whose contents should outrank the database.
 */
function localMastersIsEmpty(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(LOCAL_STATE_KEY);
    if (!raw) return true;
    const state = JSON.parse(raw) as { classes?: unknown };
    return !Array.isArray(state.classes) || state.classes.length === 0;
  } catch {
    return true;
  }
}
type DeskMeta = {
  updatedAt: string;
  classCount: number;
  feeHeadCount: number;
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") {
    return { updatedAt: "", classCount: 0, feeHeadCount: 0 };
  }
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", classCount: 0, feeHeadCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      classCount: Number(p.classCount) || 0,
      feeHeadCount: Number(p.feeHeadCount) || 0,
    };
  } catch {
    return { updatedAt: "", classCount: 0, feeHeadCount: 0 };
  }
}

function writeMeta(patch: DeskMeta) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify(patch));
}

/** Last local edit time (saveMasters / tenant wipe). */
export function readLocalMastersEditAt(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(LOCAL_EDIT_META_KEY);
    if (!raw) return "";
    return String((JSON.parse(raw) as { updatedAt?: string }).updatedAt || "");
  } catch {
    return "";
  }
}

/** Optimistic desk meta after local save — prevents stale DB overwriting edits on refresh. */
export function touchMastersDeskLocalMeta(state: MastersState, at?: string) {
  if (typeof window === "undefined") return;
  const updatedAt = at || new Date().toISOString();
  writeMeta({
    updatedAt,
    classCount: state.classes?.length ?? 0,
    feeHeadCount: state.feeHeads?.length ?? 0,
  });
}

function remoteDeskHasData(
  bundle: Omit<MastersState, "version">,
  body: {
    classCount?: number;
    feeHeadCount?: number;
    sliceCount?: number;
    updatedAt?: string;
  },
): boolean {
  if ((body.sliceCount ?? 0) > 0) return true;
  return (
    (body.classCount ?? bundle.classes?.length ?? 0) > 0 ||
    (body.feeHeadCount ?? bundle.feeHeads?.length ?? 0) > 0 ||
    (bundle.subjects?.length ?? 0) > 0 ||
    !!bundle.schoolProfile ||
    (bundle.campuses?.length ?? 0) > 0
  );
}

export async function hydrateMastersDeskFromDb(
  preferDb?: boolean,
): Promise<{ bundle: Omit<MastersState, "version">; changed: boolean; ok: boolean }> {
  const { version: _v, ...empty } = emptyMastersShell();

  if (!isSupabaseConfigured()) return { bundle: empty, changed: false, ok: true };
  try {
    const res = await fetch("/api/school-data/masters-desk", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return { bundle: empty, changed: false, ok: false };
    const body = (await res.json()) as Omit<MastersState, "version"> & {
      updatedAt?: string;
      classCount?: number;
      feeHeadCount?: number;
      sliceCount?: number;
      meta?: { sliceCount?: number; updatedAt?: string };
      sliceStamps?: Record<string, string> | null;
    };
    const { sliceStamps, ...bundleBody } = body;
    const bundle = bundleBody as Omit<MastersState, "version">;
    if ((body as { teachingOnly?: boolean }).teachingOnly) {
      // A teacher's view of Masters (classes, subjects, holidays — no fees).
      // Take it, but record no revision: this browser has not seen the whole
      // desk, so it must never become a base for a push, and the next
      // full-rights sign-in here must re-read everything.
      return { bundle, changed: true, ok: true };
    }
    const meta = readMeta();
    const localEditAt = readLocalMastersEditAt();
    const remoteAt = body.updatedAt || body.meta?.updatedAt || "";
    const sliceCount = body.sliceCount ?? body.meta?.sliceCount ?? 0;
    const remoteClasses = body.classCount ?? bundle.classes?.length ?? 0;
    const hasRemote = remoteDeskHasData(bundle, {
      classCount: body.classCount,
      feeHeadCount: body.feeHeadCount,
      sliceCount,
      updatedAt: remoteAt,
    });

    const flag = process.env.NEXT_PUBLIC_MASTERS_READ_FROM_DB?.trim().toLowerCase();
    const readFromDb = preferDb || flag !== "false";

    const remoteIsNewer =
      !!remoteAt &&
      (!meta.updatedAt || remoteAt > meta.updatedAt) &&
      (!localEditAt || remoteAt > localEditAt);

    const bootstrapNewDevice =
      hasRemote && !meta.updatedAt && !localEditAt;

    // An empty desk has nothing to defend, so it must never block hydration.
    // See localMastersIsEmpty: this is the one case where local loses despite
    // a newer localEditAt, and it is the case that froze every device.
    const localIsEmpty = localMastersIsEmpty();

    // Never let "remote has rows" alone clobber newer local edits (read-from-DB mode).
    const shouldTake = readFromDb
      ? remoteIsNewer || ((!localEditAt || localIsEmpty) && hasRemote)
      : hasRemote && (bootstrapNewDevice || remoteIsNewer || localIsEmpty);

    // The server's revision is recorded only when this browser takes the
    // server's copy. Recording it while KEEPING an older local copy (as
    // before 10 Oct 2026) let that copy pass the revision lock on its next
    // save — the refused Masters came straight back. A browser that keeps a
    // pending edit pushes against the revision it last took; if Masters has
    // moved on, the server refuses (409), the claim above is dropped, and
    // the reload takes the server's copy. A page reload always starts from
    // the server now (module data is not stored on the device).
    if (!shouldTake) return { bundle: empty, changed: false, ok: true };
    writeMeta({
      // Same rule as the push path: a revision only ever comes from the
      // server. Keep the previous one rather than stamping a local clock.
      updatedAt: remoteAt || meta.updatedAt,
      classCount: remoteClasses,
      feeHeadCount: body.feeHeadCount ?? bundle.feeHeads?.length ?? 0,
    });
    return { bundle, changed: true, ok: true };
  } catch {
    return { bundle: empty, changed: false, ok: false };
  }
}
