/**
 * Reports Center prefs — recent opens (localStorage). Export engine stays per-module.
 */

import type { ReportsCenterEntry } from "@/lib/reportsCenterCatalog";

const RECENT_KEY = "bhb_reports_center_recent_v1";
const MAX_RECENT = 20;

export type ReportsCenterRecentItem = {
  key: string;
  moduleId: string;
  reportId: string;
  label: string;
  href: string;
  at: string;
};

function readRecent(): ReportsCenterRecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ReportsCenterRecentItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecent(items: ReportsCenterRecentItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
}

export function loadReportsCenterRecent(): ReportsCenterRecentItem[] {
  return readRecent();
}

export function recordReportsCenterOpen(entry: ReportsCenterEntry): void {
  const next: ReportsCenterRecentItem = {
    key: entry.key,
    moduleId: entry.moduleId,
    reportId: entry.reportId,
    label: entry.label,
    href: entry.href,
    at: new Date().toISOString(),
  };
  const prev = readRecent().filter((r) => r.key !== entry.key);
  writeRecent([next, ...prev]);
}

export function clearReportsCenterRecent(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(RECENT_KEY);
}
