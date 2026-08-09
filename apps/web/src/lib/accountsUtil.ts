/**
 * Accounts — internal helpers shared across the accounts modules.
 *
 * Deliberately NOT re-exported from `@/lib/accounts`: `id`, `todayIso` and
 * `fail` are private helpers in ~20 other lib modules too, and putting these
 * on the barrel would make a name collision silently shadow one of them.
 * Import this file directly.
 */

export function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y!, m!, 0).getDate();
}

export function clampDay(ym: string, day: number): string {
  const dim = daysInMonth(ym);
  const d = Math.min(Math.max(1, Math.floor(day) || 1), dim);
  return `${ym}-${String(d).padStart(2, "0")}`;
}

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}
