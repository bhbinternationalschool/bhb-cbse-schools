"use client";

import { useEffect, useState } from "react";
import type { TeachingSection } from "@/lib/staffTeachingScope";

/**
 * "My classes" for the signed-in member of staff, from the server
 * (GET /api/v1/staff/my-classes) — the same answer the server uses to allow
 * or refuse a save, so a picker can never offer a class the save will
 * reject.
 *
 * `unrestricted` = principal / office: list the whole school as before.
 * `null` while loading or when the answer could not be fetched; callers
 * must not treat that as "no classes" (unknown is not a fact).
 */
export type MyTeaching = {
  unrestricted: boolean;
  academicYearCode: string;
  teaching: TeachingSection[];
};

let cache: { at: number; value: MyTeaching } | null = null;
const TTL_MS = 60_000;

export async function fetchMyTeaching(force = false): Promise<MyTeaching | null> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const res = await fetch("/api/v1/staff/my-classes", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: MyTeaching } & Partial<MyTeaching>;
    const data = (body.data ?? body) as MyTeaching;
    if (typeof data.unrestricted !== "boolean" || !Array.isArray(data.teaching)) {
      return null;
    }
    cache = { at: Date.now(), value: data };
    return data;
  } catch {
    return null;
  }
}

export function useMyTeaching(): { my: MyTeaching | null; loading: boolean } {
  const [my, setMy] = useState<MyTeaching | null>(cache?.value ?? null);
  const [loading, setLoading] = useState(!cache);
  useEffect(() => {
    let alive = true;
    void fetchMyTeaching().then((v) => {
      if (!alive) return;
      setMy(v);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);
  return { my, loading };
}

/** Restricted = a teacher whose pickers must be narrowed to `teaching`. */
export function isRestrictedTeacher(my: MyTeaching | null): my is MyTeaching {
  return !!my && !my.unrestricted;
}
