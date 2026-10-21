"use client";

/**
 * The parent portal's reads and writes — one place, all through the server.
 *
 * Every tab of /parent used to read the office's desks in the browser (SIS
 * roster, homework, PTM, leave, complaints, comms, notifications, chat). Those
 * refuse a parent session, so a real parent saw "No household linked" or an
 * empty page on almost every tab (found 15 Oct 2026, PR #670). The tabs now read
 * the routes the parent app already uses (`/api/v1/*`), which scope everything
 * to the signed-in parent's household on the server; nothing here sends a
 * household id. A failed read is shown as a failed read — "Could not load …"
 * with Try again — never as an empty family (R6).
 */
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import { ErpQueryError, useErpQuery } from "@/lib/data/client/hooks";
import { erpFetch } from "@/lib/data/erpFetch";

// ── Reads ──────────────────────────────────────────────────────────────────

/** A child as GET /api/v1/profile sends it (the fields the tabs use). */
export type ParentChild = {
  id: string;
  fullName: string;
  admissionNo: string;
  classLabel: string;
  rollNo?: string;
};

export type ParentProfileView = {
  household: {
    id: string;
    code: string;
    guardianName: string;
    mobile: string;
    whatsappMobile: string;
    altMobile: string;
    email: string;
    address: string;
    locality: string;
    landmark: string;
    city: string;
    state: string;
    pincode: string;
  };
  editableHouseholdFields: string[];
  documents: {
    key: string;
    label: string;
    required: boolean;
    accept?: string;
    hint?: string;
  }[];
  children: (ParentChild & {
    dob?: string;
    fatherName?: string;
    motherName?: string;
    docs?: {
      key: string;
      label: string;
      required: boolean;
      status: string;
      statusLabel: string;
      fileName: string;
      uploadedAt: string;
    }[];
    completeness?: { percent?: number } | number | null;
  })[];
};

function need(cond: unknown, what: string): void {
  if (!cond) throw new ErpQueryError(502, `${what} came back incomplete`);
}

export const PARENT_PROFILE_KEY = ["parent", "profile"] as const;

/** The family and its children — GET /api/v1/profile (the app's Profile screen). */
export function useParentProfile(): UseQueryResult<ParentProfileView, Error> {
  return useErpQuery<ParentProfileView>(PARENT_PROFILE_KEY, "/api/v1/profile", {
    parse: (d) => {
      const v = d as Partial<ParentProfileView> | null;
      need(
        v && v.household && Array.isArray(v.children),
        "Your family's record",
      );
      return v as ParentProfileView;
    },
  });
}

/** A typed read of a parent route, with a shape check. */
export function useParentRead<T>(
  key: readonly unknown[],
  path: string,
  check: (v: T) => unknown,
  what: string,
  enabled = true,
): UseQueryResult<T, Error> {
  return useErpQuery<T>(["parent", ...key], path, {
    enabled,
    parse: (d) => {
      need(d && check(d as T), what);
      return d as T;
    },
  });
}

/** Invalidate parent reads after a write the server confirmed. */
export function useParentRefresh(): (key: readonly unknown[]) => Promise<void> {
  const client = useQueryClient();
  return (key) => client.invalidateQueries({ queryKey: ["parent", ...key] });
}

// ── Writes ─────────────────────────────────────────────────────────────────

export type ParentWrite<T> =
  { ok: true; data: T } | { ok: false; error: string };

/** POST to a parent route. Success only when the server said so. */
export async function parentPost<T = unknown>(
  path: string,
  body: unknown,
): Promise<ParentWrite<T>> {
  try {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const res = await erpFetch(path, {
      method: "POST",
      headers: isForm ? undefined : { "Content-Type": "application/json" },
      body: isForm ? (body as FormData) : JSON.stringify(body ?? {}),
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      data?: T;
      error?: { message?: string } | string;
    } | null;
    if (res.ok && json?.ok === true) return { ok: true, data: json.data as T };
    const e = json?.error;
    const msg = typeof e === "string" ? e : e?.message;
    return {
      ok: false,
      error: msg || `Could not save (${res.status}) — try again`,
    };
  } catch {
    return {
      ok: false,
      error: "Could not reach the school — check your connection and try again",
    };
  }
}

// ── UI pieces ──────────────────────────────────────────────────────────────

/**
 * Loading / failed / ready for one read. A failed read never renders the
 * page underneath: the parent sees what failed and can ask again.
 */
export function ParentReadState<T>({
  query,
  what,
  children,
}: {
  query: UseQueryResult<T, Error>;
  /** "homework", "your leave requests" … */
  what: string;
  children: (data: T) => React.ReactNode;
}) {
  if (query.isPending && query.fetchStatus !== "idle") {
    return (
      <p
        className="px-4 py-8 text-center text-sm text-[var(--muted)]"
        role="status"
      >
        Loading {what}…
      </p>
    );
  }
  if (query.data === undefined) {
    if (query.isPending) return null; // not asked yet (disabled)
    return (
      <div
        className="px-4 py-10 text-center"
        role="alert"
        data-testid="parent-read-error"
      >
        <p className="text-base font-semibold text-[var(--brand-deep)]">
          Could not load {what}
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {query.error?.message || "Please check your connection."}
        </p>
        <button
          type="button"
          className="btn-accent mt-4 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? "Trying…" : "Try again"}
        </button>
      </div>
    );
  }
  return <>{children(query.data)}</>;
}

/** The family's children (from the profile read) and which one is shown. */
export function useActiveChild(children: ParentChild[] | undefined) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const list = children ?? [];
  const child = list.find((c) => c.id === activeId) ?? list[0] ?? null;
  return { child, setActiveId, list };
}

export function ChildPicker({
  list,
  child,
  onPick,
}: {
  list: ParentChild[];
  child: ParentChild | null;
  onPick: (id: string) => void;
}) {
  if (list.length <= 1) {
    return child ? (
      <p className="mb-2 text-sm font-semibold text-[var(--brand-deep)]">
        {child.fullName}
        <span className="ml-2 text-xs font-normal text-[var(--muted)]">
          {child.classLabel}
        </span>
      </p>
    ) : null;
  }
  return (
    <div
      className="mb-3 flex flex-wrap gap-1.5"
      role="group"
      aria-label="Child"
    >
      {list.map((c) => (
        <button
          key={c.id}
          type="button"
          data-child-id={c.id}
          aria-pressed={child?.id === c.id}
          onClick={() => onPick(c.id)}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            child?.id === c.id
              ? "bg-[var(--brand-deep)] text-white"
              : "bg-[rgba(32,48,80,0.08)] text-[var(--brand-deep)]"
          }`}
        >
          {c.fullName}
        </button>
      ))}
    </div>
  );
}

/**
 * The tabs that work per child: the children come from the profile read, and
 * the tab's own read waits for it. Either failing shows the failed state.
 */
export function WithChildren({
  children,
}: {
  children: (list: ParentChild[]) => React.ReactNode;
}) {
  const profile = useParentProfile();
  return (
    <ParentReadState query={profile} what="your family's record">
      {(p) =>
        p.children.length === 0 ? (
          <p className="px-4 py-8 text-sm text-[var(--muted)]">
            No children are on your family&apos;s record this year. Please
            contact the school office.
          </p>
        ) : (
          children(p.children)
        )
      }
    </ParentReadState>
  );
}

export function Flash({
  notice,
  error,
}: {
  notice: string | null;
  error: string | null;
}) {
  return (
    <>
      {error ? (
        <p
          className="mb-3 rounded-lg bg-[rgba(180,35,24,0.08)] px-3 py-2 text-sm text-[var(--danger)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          className="mb-3 rounded-lg bg-[rgba(15,122,76,0.1)] px-3 py-2 text-sm text-[var(--success)]"
          role="status"
        >
          {notice}
        </p>
      ) : null}
    </>
  );
}

export function useFlash() {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return {
    notice,
    error,
    ok(msg: string) {
      setError(null);
      setNotice(msg);
      window.setTimeout(() => setNotice(null), 2800);
    },
    fail(msg: string) {
      setNotice(null);
      setError(msg);
    },
    clear() {
      setError(null);
    },
  };
}
