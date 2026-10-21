"use client";

/**
 * A Masters form's draft of an object slice (school profile, timing, statutory
 * setup) AND the slice stamp it was loaded at (data-layer 2.2c review).
 *
 * An object slice is saved whole. Saved on the view's LATEST stamp, a form
 * opened before someone else's save would silently put their values back.
 * Saved on the stamp the form was LOADED at, it is refused as a conflict
 * instead — the person is told and shown the newer values.
 *
 * When a newer saved value arrives: a form with no unsaved typing follows it
 * (draft and base move on); a form whose draft already equals it (this tab's
 * own save coming back) moves its base on; a form with typing keeps both —
 * its save then conflicts rather than overwrites.
 */
import { useEffect, useState } from "react";
import { useMasters } from "@/lib/data/client/hooks";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function objectDraftStep<T>(
  s: { draft: T; loaded: T; base: string | undefined },
  saved: T,
  stamp: string | undefined,
): { draft: T; loaded: T; base: string | undefined } {
  if (same(saved, s.loaded) && stamp === s.base) return s;
  if (same(s.draft, s.loaded)) return { draft: saved, loaded: saved, base: stamp };
  if (same(s.draft, saved)) return { draft: s.draft, loaded: saved, base: stamp };
  return { draft: s.draft, loaded: saved, base: s.base };
}

export function useObjectDraft<T>(
  sliceKey: "schoolProfile" | "schoolTiming" | "statutoryConfig",
  saved: T,
): { draft: T; setDraft: (next: T | ((d: T) => T)) => void; base: string | undefined } {
  const stamp = useMasters().data?.stamps?.[sliceKey];
  const [s, setS] = useState(() => ({ draft: saved, loaded: saved, base: stamp }));
  useEffect(() => {
    setS((cur) => objectDraftStep(cur, saved, stamp));
  }, [saved, stamp]);
  return {
    draft: s.draft,
    base: s.base,
    setDraft: (next) => setS((cur) => ({ ...cur, draft: typeof next === "function" ? (next as (d: T) => T)(cur.draft) : next })),
  };
}
