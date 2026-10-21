import type { NumberSeries } from "@/lib/foundationMasters";
import { loadMasters } from "@/lib/masters";

/** Find a series by stable code (e.g. ADMISSION, STAFF_ID). */
export function findNumberSeries(
  list: NumberSeries[] | undefined,
  code: string,
): NumberSeries | undefined {
  return (list ?? []).find((s) => s.code === code);
}

/** Resolve prefix, optionally inserting academic session code. */
export function resolveSeriesPrefix(
  series: NumberSeries,
  academicYearCode?: string,
): string {
  const base = series.prefix;
  if (!series.includeSessionInPrefix || !academicYearCode?.trim()) {
    return base;
  }
  const ay = academicYearCode.trim();
  if (base.endsWith("/")) {
    return `${base}${ay}/`;
  }
  if (base.endsWith("-")) {
    return `${base}${ay}-`;
  }
  return `${base}-${ay}-`;
}

/** Next counter value without incrementing. */
export function peekNextSeriesNumber(
  series: NumberSeries,
  academicYearCode?: string,
): number {
  if (series.resetOnAy && academicYearCode?.trim()) {
    const ay = academicYearCode.trim();
    return series.countersByAy?.[ay] ?? series.nextNumber;
  }
  return series.nextNumber;
}

/** Full preview of the next formatted number. */
export function formatSeriesNumber(
  series: NumberSeries,
  academicYearCode?: string,
): string {
  const prefix = resolveSeriesPrefix(series, academicYearCode);
  const n = peekNextSeriesNumber(series, academicYearCode);
  return `${prefix}${String(n).padStart(series.padWidth, "0")}`;
}

/** Allocate and increment the appropriate counter. */
export function allocateNextSeriesNumber(
  series: NumberSeries,
  academicYearCode?: string,
): { formatted: string; next: NumberSeries } {
  const prefix = resolveSeriesPrefix(series, academicYearCode);
  const current = peekNextSeriesNumber(series, academicYearCode);
  const formatted = `${prefix}${String(current).padStart(series.padWidth, "0")}`;

  if (series.resetOnAy && academicYearCode?.trim()) {
    const ay = academicYearCode.trim();
    return {
      formatted,
      next: {
        ...series,
        countersByAy: { ...series.countersByAy, [ay]: current + 1 },
      },
    };
  }

  return {
    formatted,
    next: { ...series, nextNumber: current + 1 },
  };
}

/**
 * Suggest the next formatted number from masters config.
 * Uses max(masters counter, highest existing value with same prefix) + 1.
 */
export function suggestSeriesNumber(
  series: NumberSeries,
  academicYearCode: string | undefined,
  existingValues: string[],
): string {
  const prefix = resolveSeriesPrefix(series, academicYearCode);
  let max = peekNextSeriesNumber(series, academicYearCode) - 1;
  for (const raw of existingValues) {
    const val = (raw || "").trim();
    if (!val.startsWith(prefix)) continue;
    const tail = val.slice(prefix.length);
    const n = Number(tail);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next = max + 1;
  return `${prefix}${String(next).padStart(series.padWidth, "0")}`;
}

/** Suggest from masters list by code; null when series is not configured. */
export function suggestFromSeriesCode(
  list: NumberSeries[] | undefined,
  code: string,
  academicYearCode: string | undefined,
  existingValues: string[],
): string | null {
  const series = findNumberSeries(list, code);
  if (!series) return null;
  return suggestSeriesNumber(series, academicYearCode, existingValues);
}

/** Bump series counter after a formatted number is issued. */
export function advanceSeriesAfterUse(
  series: NumberSeries,
  academicYearCode: string | undefined,
  usedFormatted: string,
): NumberSeries {
  const prefix = resolveSeriesPrefix(series, academicYearCode);
  const val = (usedFormatted || "").trim();
  if (!val.startsWith(prefix)) return series;
  const n = Number(val.slice(prefix.length));
  if (!Number.isFinite(n) || n < 1) return series;
  const floor = n + 1;

  if (series.resetOnAy && academicYearCode?.trim()) {
    const ay = academicYearCode.trim();
    const current = series.countersByAy?.[ay] ?? series.nextNumber;
    if (floor <= current) return series;
    return {
      ...series,
      countersByAy: { ...series.countersByAy, [ay]: floor },
    };
  }

  if (floor <= series.nextNumber) return series;
  return { ...series, nextNumber: floor };
}

export function advanceMastersSeries(
  numberSeries: NumberSeries[],
  code: string,
  academicYearCode: string | undefined,
  usedFormatted: string,
): NumberSeries[] {
  const series = findNumberSeries(numberSeries, code);
  if (!series || !usedFormatted?.trim()) return numberSeries;
  const updated = advanceSeriesAfterUse(series, academicYearCode, usedFormatted);
  if (updated === series) return numberSeries;
  return numberSeries.map((s) => (s.id === series.id ? updated : s));
}

/**
 * The number a formatted value carries for this series (its tail after the
 * prefix), or null when it is not one of the series' numbers.
 */
export function seriesNumberOf(
  series: NumberSeries,
  academicYearCode: string | undefined,
  usedFormatted: string,
): number | null {
  const prefix = resolveSeriesPrefix(series, academicYearCode);
  const val = (usedFormatted || "").trim();
  if (!val.startsWith(prefix)) return null;
  const n = Number(val.slice(prefix.length));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * After issuing a number: move the series past it on the server
 * (POST /api/data/masters.number-series/bump → masters_series_bump —
 * data-layer 2.2c). Monotone and without a base, so two desks issuing at
 * once cannot undo each other; the screens see the new next number at the
 * next masters answer (the versions poll). Before 2.2c this saved the whole
 * numberSeries list from the tab's copy through saveMasters.
 */
export function persistSeriesUse(
  code: string,
  academicYearCode: string | undefined,
  usedFormatted: string,
): void {
  if (typeof window === "undefined" || !usedFormatted?.trim()) return;
  const series = findNumberSeries(loadMasters().numberSeries, code);
  if (!series) return;
  const used = seriesNumberOf(series, academicYearCode, usedFormatted);
  if (used === null) return;
  // Already past it as far as this tab knows: nothing to move.
  if (used + 1 <= peekNextSeriesNumber(series, academicYearCode)) return;
  const ay = series.resetOnAy && academicYearCode?.trim() ? academicYearCode.trim() : undefined;
  void bumpSeriesOnServer(series.code || series.id, series.label || code, used, ay);
}

/**
 * POST the bump; a failure is retried once (a network blink), and a failure
 * that stands is SAID on screen — the next number offered may otherwise repeat
 * one already issued. A refusal (403 not your series, 409 too far ahead) is
 * not retried.
 */
export async function bumpSeriesOnServer(
  series: string,
  label: string,
  used: number,
  ay: string | undefined,
  deps: { post?: typeof fetch; say?: (message: string) => void } = {},
): Promise<boolean> {
  const post = deps.post ?? fetch;
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await post(`/api/data/${encodeURIComponent("masters.number-series")}/bump`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ series, used, ...(ay ? { ay } : {}) }),
      });
      if (res.ok) return true;
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      last = body?.message || `HTTP ${res.status}`;
      if (res.status === 403 || res.status === 409 || res.status === 400 || res.status === 404) break;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  const message = `${label}: the next number was not moved past ${used} (${last}). The next number offered may repeat — check it before issuing.`;
  console.warn(`[number-series] ${message}`);
  if (deps.say) deps.say(message);
  else if (typeof window !== "undefined") {
    void import("@/components/shell/Toast")
      .then(({ pushToast }) => pushToast({ kind: "error", message, durationMs: 0 }))
      .catch(() => undefined);
  }
  return false;
}

export function bumpStudentSeriesUses(
  student: {
    admissionNo: string;
    registrationNo?: string;
    srn?: string;
  },
  academicYearCode?: string,
): void {
  if (student.admissionNo) {
    persistSeriesUse("ADMISSION", academicYearCode, student.admissionNo);
  }
  if (student.registrationNo) {
    persistSeriesUse("REGISTRATION", academicYearCode, student.registrationNo);
  }
  if (student.srn) {
    persistSeriesUse("SRN", academicYearCode, student.srn);
  }
}

/**
 * The next number to issue from a series, NOT already on record
 * (POST /api/data/masters.number-series/next — data-layer 2.2c). The server
 * lifts a counter that is behind the records. Null when it cannot say (no
 * network, no permission, a series not on record): the caller keeps its own
 * suggestion.
 */
export async function fetchSeriesNext(
  code: string,
  academicYearCode: string | undefined,
  deps: { post?: typeof fetch } = {},
): Promise<{ next: number; formatted: string; lifted: boolean } | null> {
  if (typeof window === "undefined" && !deps.post) return null;
  try {
    const res = await (deps.post ?? fetch)(`/api/data/${encodeURIComponent("masters.number-series")}/next`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ series: code, ...(academicYearCode ? { ay: academicYearCode } : {}) }),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { ok?: boolean; next?: number; formatted?: string; lifted?: boolean } | null;
    if (!body?.ok || typeof body.next !== "number" || typeof body.formatted !== "string") return null;
    return { next: body.next, formatted: body.formatted, lifted: body.lifted === true };
  } catch {
    return null;
  }
}
