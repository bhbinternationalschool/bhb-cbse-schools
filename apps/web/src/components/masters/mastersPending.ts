/**
 * What the Masters editor shows between a commit and the server's answer that
 * holds it (data-layer 2.1h review fix; pure — mastersPending.selftest.ts).
 *
 * The editor reads the server's book (useScreenMasters). A commit saves the
 * whole book through saveMasters (unchanged until 2.2) and, until an answer
 * of the masters view PROVABLY contains that save, shows what it sent: the
 * overlay. Dropping the overlay on the first answer after the save was wrong:
 * that answer can be older than the save (another instance's masters cache
 * re-checks the versions at most every 2 s; a refetch can fail and leave the
 * old answer in place). The screen then went back to the old book, and the
 * next commit — built from what the screen shows — sent the old value of the
 * first edit's section again, over the first edit, on the server.
 *
 * An answer proves the save when either
 *   - it was built from the desk revision the save wrote or a later one
 *     (builtFrom.masters.updated_at ≥ the save's revision — erp_versions
 *     serves masters_desk_sync_meta.updated_at, which every Masters write
 *     moves to its own instant), or
 *   - every book key the commits changed reads, in the answer, exactly what
 *     the overlay holds (for a save that answered no revision: a function-
 *     only save, no database).
 * No proof while a commit is still saving.
 *
 * A failed save drops the overlay (once nothing else is saving): the edit
 * was not stored, and holding it would stop the tab taking answers and send
 * it again with the next commit over other people's changes. The screen then
 * shows the server's book; the push path's sticky toast says why.
 */
import type { MastersState } from "@/lib/masters";
import { rowFingerprint } from "@/lib/sliceRevClient";

export type MastersOverlay = {
  /** What the latest commit sent — shown instead of the server's answer. */
  state: MastersState;
  /** Book keys the commits since the overlay began changed. */
  keys: string[];
  /** Commits sent and not yet answered. */
  saving: number;
  /** The latest desk revision a save of this overlay wrote ("" = none answered). */
  revision: string;
};

export type SaveAnswer = { ok: true; revision?: string } | { ok: false };

/** Keys whose content differs between two books (`version` aside). */
export function changedMastersKeys(before: MastersState | null, after: MastersState): string[] {
  const a = (before ?? {}) as unknown as Record<string, unknown>;
  const b = after as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("version");
  return [...keys].filter((k) => rowFingerprint(a[k] ?? null) !== rowFingerprint(b[k] ?? null)).sort();
}

/** A commit: `shown` is what the screen showed (the base), `next` what is sent. */
export function overlayOnCommit(prev: MastersOverlay | null, shown: MastersState | null, next: MastersState): MastersOverlay {
  const keys = new Set([...(prev?.keys ?? []), ...changedMastersKeys(shown, next)]);
  return {
    state: next,
    keys: [...keys].sort(),
    saving: (prev?.saving ?? 0) + 1,
    revision: prev?.revision ?? "",
  };
}

function later(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** A save answered. Null = drop the overlay (the save failed and nothing else is saving). */
export function overlayOnSaved(prev: MastersOverlay | null, answer: SaveAnswer): MastersOverlay | null {
  if (!prev) return null;
  const saving = Math.max(0, prev.saving - 1);
  if (!answer.ok) {
    // Another commit still in flight carries this one's edit too (it was
    // built from the overlay) — its answer decides. Otherwise: not stored.
    if (saving > 0) return { ...prev, saving };
    return null;
  }
  return { ...prev, saving, revision: later(prev.revision, answer.revision ?? "") };
}

type BuiltFrom = Record<string, { updated_at: string | null } | null | undefined> | null;

/** Does this answer of the masters view (normalised as the editor reads it) hold the overlay's saves? */
export function answerHoldsOverlay(overlay: MastersOverlay, answer: MastersState | null, builtFrom: BuiltFrom): boolean {
  if (overlay.saving > 0 || !answer) return false;
  const at = builtFrom?.masters?.updated_at ?? null;
  if (overlay.revision && at) {
    const built = Date.parse(at);
    const saved = Date.parse(overlay.revision);
    if (Number.isFinite(built) && Number.isFinite(saved) && built >= saved) return true;
  }
  const a = answer as unknown as Record<string, unknown>;
  const o = overlay.state as unknown as Record<string, unknown>;
  return overlay.keys.every((k) => rowFingerprint(a[k] ?? null) === rowFingerprint(o[k] ?? null));
}
