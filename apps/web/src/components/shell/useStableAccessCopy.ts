"use client";

import { useMemo, useRef } from "react";
import type { MastersState } from "@/lib/masters";
import type { RbacState } from "@/lib/rbac";
import { useAccessData, type AccessData } from "@/components/shell/useAccessData";
import { useMasters } from "@/lib/data/client/hooks";
import { screenMastersOf } from "@/lib/data/client/mastersBridge";

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
 * The access copy (useAccessData: the roster and the roles the sidebar and
 * the module gate decide with) joined with the school's Masters book
 * (useMasters — classes, sections, subjects, class-subject links; since
 * data-layer 2.3a the access copy no longer carries them), with an identity
 * that only moves when what a permission or chat-scope answer reads has
 * changed (data-layer 2.1f).
 *
 * A read answering again (the versions poll, a refetch on focus) hands back
 * new objects even when nothing a permission check reads moved; a shell
 * component whose effects are keyed on the copy (the AI assistant's history,
 * the chat's thread list) would re-run them each time. This keeps the
 * previous copies while the ACCESS_KEYS of Masters and the whole rbac are
 * the same.
 *
 * `enabled: false` (the header chat or assistant while closed) asks the
 * masters view nothing; the answer the shell already holds (AppShell waits
 * for it on every page) is still used. Null until the access copy AND a
 * Masters answer are in — the caller waits, it never guesses.
 */
export function useStableAccessCopy(opts: { enabled?: boolean } = {}): StableAccessCopy {
  const access = useAccessData();
  const book = useMasters({ enabled: opts.enabled });
  const kept = useRef<{ sig: string; masters: MastersState; rbac: RbacState } | null>(null);
  const copies = useMemo(() => {
    if (!access.ready || !access.masters || !access.rbac) return null;
    const masters = screenMastersOf(book.data, access.masters);
    if (!masters) return null;
    const m = masters as unknown as Record<string, unknown>;
    const sig = JSON.stringify([ACCESS_KEYS.map((k) => m[k] ?? null), access.rbac]);
    if (kept.current?.sig !== sig) kept.current = { sig, masters, rbac: access.rbac };
    return kept.current;
  }, [access.ready, access.masters, access.rbac, book.data]);
  return {
    status: access.status,
    ready: access.ready,
    retry: access.retry,
    masters: copies?.masters ?? null,
    rbac: copies?.rbac ?? null,
  };
}
