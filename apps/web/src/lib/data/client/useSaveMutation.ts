"use client";

/**
 * The save interaction, in one place.
 *
 * Every workspace currently owns its own version of this and they are all
 * wrong in the same way: `commit()` calls `setNotice("saved")` synchronously
 * and then fires the write, so the notice reports that React updated, not
 * that the database did. On 2026-08-09 that turned 16 refused writes into 16
 * apparent successes.
 *
 * The rule this enforces: **"Saved" may only appear after the server said so.**
 * A failure blocks, keeps the form dirty, and says what actually happened.
 */

import { useCallback, useRef, useState } from "react";
import { describeWriteFailure, type WriteOp, type WriteResult } from "../types";
import { writeRecords } from "./mutate";

export type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "failed"; message: string; kind: string };

export type UseSaveMutation<T> = {
  readonly state: SaveState;
  /** True while in flight — disable the control, do not hide it. */
  readonly pending: boolean;
  /**
   * True when the last attempt failed. The caller keeps the form dirty and
   * the user's input on screen: discarding what someone typed because the
   * network blinked is its own kind of data loss.
   */
  readonly failed: boolean;
  save: (ops: readonly WriteOp<T>[]) => Promise<WriteResult<T>>;
  reset: () => void;
};

export function useSaveMutation<T>(
  collection: string,
  opts?: {
    /** Called only on a confirmed write. Refresh reads from here. */
    onSaved?: (result: Extract<WriteResult<T>, { ok: true }>) => void;
    /** Called on any failure, for a modal or a sticky toast. */
    onFailed?: (result: Extract<WriteResult<T>, { ok: false }>) => void;
    /** ms before a "saved" indicator returns to idle. */
    savedForMs?: number;
  },
): UseSaveMutation<T> {
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A late response from a superseded save must not overwrite a newer one.
  const seq = useRef(0);

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setState({ status: "idle" });
  }, []);

  const save = useCallback(
    async (ops: readonly WriteOp<T>[]): Promise<WriteResult<T>> => {
      const mine = ++seq.current;
      if (timer.current) clearTimeout(timer.current);
      setState({ status: "saving" });

      const result = await writeRecords<T>(collection, ops);

      // A stale response is dropped rather than rendered.
      if (mine !== seq.current) return result;

      if (result.ok) {
        setState({ status: "saved" });
        opts?.onSaved?.(result);
        const ms = opts?.savedForMs ?? 2000;
        if (ms > 0) {
          timer.current = setTimeout(
            () => setState({ status: "idle" }),
            ms,
          );
        }
        return result;
      }

      // Failures do NOT auto-clear. The user has to see it and act.
      setState({
        status: "failed",
        kind: result.kind,
        message: describeWriteFailure(result),
      });
      opts?.onFailed?.(result);
      return result;
    },
    [collection, opts],
  );

  return {
    state,
    pending: state.status === "saving",
    failed: state.status === "failed",
    save,
    reset,
  };
}
