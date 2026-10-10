"use client";

/**
 * App-wide toast host. Any code — component or plain module — can raise a
 * toast without a hook by calling pushToast(), which dispatches a
 * CustomEvent this host listens for (same pattern already used elsewhere
 * in this app for cross-module signals, e.g. "bhb-desk-synced").
 *
 * Primary use: surfacing hydrate/sync failures that would otherwise look
 * identical to "this module genuinely has no data" (see fetchXFromDb ok
 * checks across the *Persistence.ts files).
 */

import { useEffect, useRef, useState } from "react";

export type ToastKind = "error" | "info" | "success";

export type ToastDetail = {
  kind: ToastKind;
  message: string;
  /** ms before auto-dismiss; 0 = stays until closed. Default 6000 for errors, 3500 otherwise. */
  durationMs?: number;
};

const EVENT = "bhb-toast";
let seq = 0;

/** Raise a toast from anywhere — component, persistence lib, or event handler. */
export function pushToast(detail: ToastDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ToastDetail>(EVENT, { detail }));
}

/** Convenience for the common "fetch failed, don't let this look like empty data" case. */
export function reportLoadFailure(moduleLabel: string) {
  pushToast({
    kind: "error",
    message: `Couldn't load ${moduleLabel} — showing your last saved data. Check your connection and try again.`,
  });
}

type LiveToast = ToastDetail & { id: number; count: number };

const KIND_STYLES: Record<ToastKind, string> = {
  error: "border-[var(--danger)]/30 bg-[var(--danger-soft)] text-[var(--danger)]",
  info: "border-[var(--brand-deep)]/25 bg-[var(--surface,#fff)] text-[var(--brand-deep)]",
  success: "border-[var(--success)]/25 bg-[var(--success-soft)] text-[var(--success)]",
};

export function ToastHost() {
  const [toasts, setToasts] = useState<LiveToast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastDetail>).detail;
      if (!detail?.message) return;
      const duration =
        detail.durationMs ?? (detail.kind === "error" ? 6000 : 3500);

      // Same kind+message already showing (e.g. the same blocked-save
      // error firing on every retry) — bump its count and refresh its
      // timer instead of stacking a duplicate box. This is what actually
      // stops a repeated failure from visibly piling up on screen.
      setToasts((prev) => {
        const existing = prev.find(
          (t) => t.kind === detail.kind && t.message === detail.message,
        );
        if (existing) {
          const oldTimer = timers.current.get(existing.id);
          if (oldTimer) clearTimeout(oldTimer);
          if (duration > 0) {
            const t = setTimeout(() => dismiss(existing.id), duration);
            timers.current.set(existing.id, t);
          }
          return prev.map((t) =>
            t.id === existing.id ? { ...t, count: t.count + 1 } : t,
          );
        }
        const id = ++seq;
        if (duration > 0) {
          const t = setTimeout(() => dismiss(id), duration);
          timers.current.set(id, t);
        }
        return [...prev, { ...detail, id, count: 1 }];
      });
    }
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  function dismiss(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }

  if (toasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:right-4 sm:left-auto"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg ${KIND_STYLES[t.kind]}`}
        >
          <span className="flex-1">
            {t.message}
            {t.count > 1 ? (
              <span className="ml-1 opacity-70">(×{t.count})</span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="shrink-0 rounded px-1 text-xs opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
