"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

const COOKIE = "bhb_theme";
type ThemePref = "light" | "dark" | "system";

function readCookiePref(): ThemePref {
  if (typeof document === "undefined") return "system";
  const m = document.cookie.match(/(?:^|; )bhb_theme=([^;]*)/);
  const v = m ? decodeURIComponent(m[1]) : "system";
  return v === "light" || v === "dark" ? v : "system";
}

function applyTheme(pref: ThemePref) {
  const isDark =
    pref === "dark" ||
    (pref === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", isDark ? "#0e1526" : "#203050");
}

function writeCookiePref(pref: ThemePref) {
  document.cookie = `${COOKIE}=${pref}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

const OPTIONS: { key: ThemePref; icon: typeof Sun; label: string }[] = [
  { key: "light", icon: Sun, label: "Light" },
  { key: "system", icon: Monitor, label: "System" },
  { key: "dark", icon: Moon, label: "Dark" },
];

/** 3-state light/system/dark toggle. Self-contained — drop in anywhere. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [pref, setPref] = useState<ThemePref>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setPref(readCookiePref());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref, mounted]);

  function choose(next: ThemePref) {
    setPref(next);
    writeCookiePref(next);
    applyTheme(next);
  }

  if (!mounted) {
    // Server-rendered shell only — the active icon depends on the cookie,
    // which we can't read during SSR without making the whole layout
    // dynamic. Avoids a hydration flicker on which icon looks "active".
    return (
      <div
        aria-hidden
        className={`inline-flex h-7 items-center gap-0.5 rounded-lg border border-[var(--border)] p-0.5 ${className}`}
      />
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={`inline-flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-0.5 ${className}`}
    >
      {OPTIONS.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={pref === key}
          title={label}
          onClick={() => choose(key)}
          className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-[var(--motion-fast)] ${
            pref === key
              ? "bg-[var(--card)] text-[var(--brand-deep)] shadow-[var(--shadow-1)]"
              : "text-[var(--muted)] hover:text-[var(--brand-deep)]"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
