"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LogOut, Pencil, Shield, UserRound } from "lucide-react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { SessionSelector } from "@/components/shell/SessionSelector";
import type { DemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import {
  canConfigureRbac,
  inferRoleCodes,
  loadRbac,
  resolveSessionRoles,
} from "@/lib/rbac";
import { resolveSessionStaff } from "@/lib/staffResolve";
import { TENANT } from "@/lib/types";

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function UserAccountMenu({
  session,
  clock,
  onLogout,
}: {
  session: DemoSession;
  clock: string;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const { staff, roleLabels, canManageRoles } = useMemo(() => {
    const masters = loadMasters();
    const rbac = loadRbac();
    const staffRow = resolveSessionStaff(session, masters);
    const roles = resolveSessionRoles(rbac, session, masters);
    const labels =
      roles.length > 0
        ? roles.map((r) => r.name)
        : inferRoleCodes(session, masters).map((code) => {
            const named = rbac.roles.find((r) => r.code === code);
            return named?.name || code;
          });
    return {
      staff: staffRow,
      roleLabels: [...new Set(labels.filter(Boolean))],
      canManageRoles: canConfigureRbac(session, masters, rbac),
    };
  }, [session]);

  const profileHref = staff ? `/staff/${staff.id}/edit` : null;
  const myDocsHref = staff ? "/staff?tab=my_docs" : null;

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setShowRoles(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setShowRoles(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function closeMenu() {
    setOpen(false);
    setShowRoles(false);
  }

  function onToggle() {
    setOpen((prev) => {
      if (prev) setShowRoles(false);
      return !prev;
    });
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={onToggle}
        className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-[var(--surface-sunken)]"
      >
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold"
          style={{
            background: TENANT.goldColor,
            color: TENANT.primaryColor,
          }}
          title={session.fullName}
        >
          {initials(session.fullName)}
        </span>
        <div className="hidden text-right md:block">
          <div className="flex items-center justify-end gap-1 text-xs font-medium text-[var(--brand-deep)]">
            <span>{session.fullName}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-[var(--muted)] transition ${open ? "rotate-180" : ""}`}
            />
          </div>
          <div
            className="text-[10px] text-[var(--muted)]"
            suppressHydrationWarning
          >
            {clock || "\u00a0"}
          </div>
        </div>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-[min(16rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-[0_12px_40px_rgba(32,48,80,0.18)]"
        >
          <div className="border-b border-[var(--border)] px-3 py-2.5 md:hidden">
            <p className="text-sm font-semibold text-[var(--brand-deep)]">
              {session.fullName}
            </p>
            {session.email ? (
              <p className="truncate text-[11px] text-[var(--muted)]">
                {session.email}
              </p>
            ) : null}
          </div>

          {showRoles ? (
            <div className="p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                Your roles
              </p>
              <ul className="mt-2 space-y-1">
                {roleLabels.length ? (
                  roleLabels.map((label) => (
                    <li
                      key={label}
                      className="rounded-md bg-[var(--surface-sunken)] px-2 py-1.5 text-xs font-medium text-[var(--brand-deep)]"
                    >
                      {label}
                    </li>
                  ))
                ) : (
                  <li className="text-xs text-[var(--muted)]">
                    No roles assigned yet.
                  </li>
                )}
              </ul>
              {canManageRoles ? (
                <Link
                  href="/masters?tab=roles"
                  role="menuitem"
                  onClick={closeMenu}
                  className="mt-3 block text-xs font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
                >
                  Open Roles &amp; permissions
                </Link>
              ) : null}
              <button
                type="button"
                onClick={() => setShowRoles(false)}
                className="mt-3 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--brand-deep)]"
              >
                Back
              </button>
            </div>
          ) : (
            <div className="py-1">
              {myDocsHref ? (
                <MenuLink
                  href={myDocsHref}
                  icon={<UserRound className="h-4 w-4" />}
                  label="Profile"
                  hint="My docs & uploads"
                  onNavigate={closeMenu}
                />
              ) : (
                <MenuButton
                  icon={<UserRound className="h-4 w-4" />}
                  label="Profile"
                  hint="No staff profile linked"
                  disabled
                />
              )}
              {profileHref ? (
                <MenuLink
                  href={profileHref}
                  icon={<Pencil className="h-4 w-4" />}
                  label="Update profile"
                  hint="Edit staff record"
                  onNavigate={closeMenu}
                />
              ) : (
                <MenuButton
                  icon={<Pencil className="h-4 w-4" />}
                  label="Update profile"
                  hint="No staff profile linked"
                  disabled
                />
              )}
              <MenuButton
                icon={<Shield className="h-4 w-4" />}
                label="User role"
                hint={
                  roleLabels[0]
                    ? roleLabels.slice(0, 2).join(" · ")
                    : session.roleCode
                }
                onClick={() => setShowRoles(true)}
              />
              <div className="my-1 border-t border-[var(--border)]" />
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-sm font-medium text-[var(--brand-deep)]">
                  Session
                </span>
                <SessionSelector currentCode={session.academicYearCode} />
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-sm font-medium text-[var(--brand-deep)]">
                  Appearance
                </span>
                <ThemeToggle />
              </div>
              <div className="my-1 border-t border-[var(--border)]" />
              <MenuButton
                icon={<LogOut className="h-4 w-4" />}
                label="Logout"
                tone="danger"
                onClick={() => {
                  closeMenu();
                  onLogout();
                }}
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  label,
  hint,
  onNavigate,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onNavigate}
      className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-[var(--surface-sunken)]"
    >
      <span className="mt-0.5 text-[var(--brand-deep)]">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--brand-deep)]">
          {label}
        </span>
        {hint ? (
          <span className="block truncate text-[11px] text-[var(--muted)]">
            {hint}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function MenuButton({
  icon,
  label,
  hint,
  onClick,
  disabled,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-start gap-2.5 px-3 py-2 text-left ${
        disabled
          ? "cursor-not-allowed opacity-50"
          : tone === "danger"
            ? "hover:bg-[rgba(180,35,24,0.06)]"
            : "hover:bg-[var(--surface-sunken)]"
      }`}
    >
      <span
        className={`mt-0.5 ${
          tone === "danger" ? "text-[var(--danger)]" : "text-[var(--brand-deep)]"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span
          className={`block text-sm font-medium ${
            tone === "danger" ? "text-[var(--danger)]" : "text-[var(--brand-deep)]"
          }`}
        >
          {label}
        </span>
        {hint ? (
          <span className="block truncate text-[11px] text-[var(--muted)]">
            {hint}
          </span>
        ) : null}
      </span>
    </button>
  );
}
