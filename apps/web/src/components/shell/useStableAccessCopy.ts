"use client";

import { useMemo, useRef } from "react";
import type { MastersState } from "@/lib/masters";
import type { RbacState } from "@/lib/rbac";
import { useAccessData, type AccessData } from "@/components/shell/useAccessData";

/**
 * The keys of the page copy that permission and "who may reach whom"
 * resolution reads (lib/rbac, lib/staffResolve, lib/erpChatAccess): the
 * roster and the class/section/subject structure a class teacher or a
 * subject teacher is resolved through.
 */
const ACCESS_KEYS = [
  "staff",
  "departments",
  "designations",
  "classes",
  "sections",
  "subjects",
  "classSubjects",
] as const;

export type StableAccessCopy = Pick<AccessData, "status" | "ready" | "retry"> & {
  masters: MastersState | null;
  rbac: RbacState | null;
};

/**
 * useAccessData's copies (the ones the sidebar and the module gate decide
 * with), with an identity that only moves when what a permission or chat-
 * scope answer reads has changed (data-layer 2.1f).
 *
 * useAccessData re-reads its copies on every desk event — two dozen on a cold
 * open — so `access.masters` is a new object each time even when nothing a
 * permission check reads moved. A shell component whose effects are keyed on
 * the copy (the AI assistant's history, the chat's thread list) would re-run
 * them on every one of those events. This keeps the previous copies while
 * the ACCESS_KEYS of Masters and the whole rbac are the same.
 *
 * For a component that reads only ACCESS_KEYS from `masters`: any other key
 * (fee heads, holidays…) may be older than the page copy.
 *
 * Starts no load of its own beyond useAccessData's (which is already on every
 * page through the gate and the sidebar) and adds no request.
 */
export function useStableAccessCopy(): StableAccessCopy {
  const access = useAccessData();
  const kept = useRef<{ sig: string; masters: MastersState; rbac: RbacState } | null>(null);
  const copies = useMemo(() => {
    if (!access.ready || !access.masters || !access.rbac) return null;
    const m = access.masters as unknown as Record<string, unknown>;
    const sig = JSON.stringify([ACCESS_KEYS.map((k) => m[k] ?? null), access.rbac]);
    if (kept.current?.sig !== sig) kept.current = { sig, masters: access.masters, rbac: access.rbac };
    return kept.current;
  }, [access.ready, access.masters, access.rbac]);
  return {
    status: access.status,
    ready: access.ready,
    retry: access.retry,
    masters: copies?.masters ?? null,
    rbac: copies?.rbac ?? null,
  };
}
