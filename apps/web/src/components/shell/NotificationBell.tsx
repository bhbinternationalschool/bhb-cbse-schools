"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";
import {
  currentStaffRecipientKey,
  listNotificationsFor,
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  recipientKey,
  unreadCountFor,
  type AppNotification,
} from "@/lib/notifications";

type Persona = "staff" | "parent";

export function NotificationBell({
  persona = "staff",
  parentMobile,
  parentName,
}: {
  persona?: Persona;
  parentMobile?: string;
  parentName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const key = useMemo(() => {
    if (persona === "parent") {
      return recipientKey({
        persona: "parent",
        mobile: parentMobile,
        fullName: parentName,
      });
    }
    return currentStaffRecipientKey();
  }, [persona, parentMobile, parentName]);

  useEffect(() => {
    let cancelled = false;
    setReady(true);
    void import("@/lib/notificationsPersistence").then(
      async ({ ensureNotificationsHydrated }) => {
        await ensureNotificationsHydrated();
        if (!cancelled) setTick((n) => n + 1);
      },
    );
    function onNf() {
      setTick((n) => n + 1);
    }
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("bhb-notifications", onNf);
    document.addEventListener("mousedown", onDoc);
    return () => {
      cancelled = true;
      window.removeEventListener("bhb-notifications", onNf);
      document.removeEventListener("mousedown", onDoc);
    };
  }, []);

  const state = useMemo(
    () => (ready ? loadNotifications() : { version: 1 as const, items: [] }),
    [ready, tick],
  );
  const items = listNotificationsFor(key, persona, state).slice(0, 12);
  const unread = ready ? unreadCountFor(key, persona, state) : 0;

  function onOpenItem(n: AppNotification) {
    markNotificationRead(n.id, key);
    setTick((t) => t + 1);
    setOpen(false);
    if (persona === "parent") {
      const tab =
        n.kind === "news"
          ? "news"
          : n.kind === "gallery"
            ? "gallery"
            : n.kind === "notice"
              ? "notices"
              : "";
      if (tab) {
        try {
          sessionStorage.setItem("bhb_parent_portal_tab", tab);
          window.dispatchEvent(
            new CustomEvent("bhb-parent-portal-tab", { detail: tab }),
          );
        } catch {
          /* ignore */
        }
      }
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
      >
        <Bell className="h-4 w-4" strokeWidth={2.25} />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-[0_12px_40px_rgba(32,48,80,0.18)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
            <p className="text-xs font-bold text-[var(--brand-deep)]">
              Notifications
            </p>
            <div className="flex gap-2">
              {unread > 0 ? (
                <button
                  type="button"
                  className="text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--brand-deep)]"
                  onClick={() => {
                    markAllNotificationsRead(key, persona);
                    setTick((t) => t + 1);
                  }}
                >
                  Mark all read
                </button>
              ) : null}
              {persona === "staff" ? (
                <Link
                  href="/comms?tab=inbox"
                  className="text-[10px] font-semibold text-[var(--brand-deep)]"
                  onClick={() => setOpen(false)}
                >
                  Open inbox
                </Link>
              ) : null}
            </div>
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-[var(--muted)]">
                No notifications yet
              </li>
            ) : (
              items.map((n) => {
                const isUnread = !n.readBy.includes(key);
                return (
                  <li key={n.id} className="border-b border-[var(--border)] last:border-0">
                    <Link
                      href={
                        persona === "parent"
                          ? "/parent"
                          : n.href || "/comms"
                      }
                      onClick={() => onOpenItem(n)}
                      className={`block px-3 py-2.5 hover:bg-[var(--surface-sunken)] ${
                        isUnread ? "bg-[rgba(197,160,40,0.08)]" : ""
                      }`}
                    >
                      <div className="flex justify-between gap-2">
                        <p className="text-xs font-semibold text-[var(--brand-deep)]">
                          {n.title}
                        </p>
                        <span className="shrink-0 text-[9px] text-[var(--muted)]">
                          {new Date(n.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      {n.body ? (
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--muted)]">
                          {n.body}
                        </p>
                      ) : null}
                    </Link>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
