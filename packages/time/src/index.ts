/** Indian Standard Time — Asia/Kolkata (UTC+05:30). All school business time uses IST. */

export const SCHOOL_TIMEZONE = "Asia/Kolkata" as const;

const IST_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  timeZone: SCHOOL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const IST_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: SCHOOL_TIMEZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const IST_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: SCHOOL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function partsMap(date: Date): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of IST_PARTS.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return map;
}

/** Current instant (UTC under the hood). */
export function now(): Date {
  return new Date();
}

/** Format for UI: `10-Jul-2026 14:35 IST` */
export function formatIst(date: Date | string | number = now()): string {
  const d = typeof date === "object" && date instanceof Date ? date : new Date(date);
  const day = IST_DATE_FORMATTER.format(d);
  const time = IST_FORMATTER.format(d).split(", ").pop() ?? "";
  // en-IN often gives DD/MM/YYYY, HH:mm:ss — normalize display
  const p = partsMap(d);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = months[Number(p.month) - 1] ?? p.month;
  return `${p.day}-${mon}-${p.year} ${p.hour}:${p.minute} IST`;
}

/** Calendar date in IST as `YYYY-MM-DD`. */
export function istDateString(date: Date | string | number = now()): string {
  const d = typeof date === "object" && date instanceof Date ? date : new Date(date);
  const p = partsMap(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Start of IST calendar day as UTC Date. */
export function startOfIstDay(date: Date | string | number = now()): Date {
  const d = typeof date === "object" && date instanceof Date ? date : new Date(date);
  const p = partsMap(d);
  // IST = UTC+5:30 → midnight IST = previous day 18:30 UTC
  return new Date(`${p.year}-${p.month}-${p.day}T00:00:00+05:30`);
}

/** End of IST calendar day (inclusive last ms) as UTC Date. */
export function endOfIstDay(date: Date | string | number = now()): Date {
  const d = typeof date === "object" && date instanceof Date ? date : new Date(date);
  const p = partsMap(d);
  return new Date(`${p.year}-${p.month}-${p.day}T23:59:59.999+05:30`);
}

export function isSameIstDay(a: Date, b: Date = now()): boolean {
  return istDateString(a) === istDateString(b);
}

/** PDF / report footer stamp. */
export function generatedAtIst(): string {
  return `Generated ${formatIst(now())}`;
}
