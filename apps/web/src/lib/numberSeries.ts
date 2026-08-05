import type { NumberSeries } from "@/lib/foundationMasters";
import { loadMasters, saveMasters } from "@/lib/masters";

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

/** Persist counter bump to masters after issuing a number. */
export function persistSeriesUse(
  code: string,
  academicYearCode: string | undefined,
  usedFormatted: string,
): void {
  if (typeof window === "undefined" || !usedFormatted?.trim()) return;
  const masters = loadMasters();
  const numberSeries = advanceMastersSeries(
    masters.numberSeries,
    code,
    academicYearCode,
    usedFormatted,
  );
  if (numberSeries === masters.numberSeries) return;
  saveMasters({ ...masters, numberSeries });
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
