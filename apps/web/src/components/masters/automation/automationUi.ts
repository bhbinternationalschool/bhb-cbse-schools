export const autoInp =
  "w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm";

export const autoBtnPrimary =
  "rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50";

export const autoBtnTeal =
  "rounded-lg bg-[var(--tone-teal-solid)] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50";

export const autoBtnOutline =
  "rounded-lg border border-[rgba(32,48,80,0.2)] px-4 py-2 text-[12px] font-semibold text-[var(--brand-deep)]";

export const autoBtnDanger =
  "rounded-lg border border-rose-300 px-3 py-1.5 text-[11px] font-semibold text-rose-800";

export const autoBtnSuccess =
  "rounded-lg bg-emerald-700 px-3 py-1.5 text-[11px] font-semibold text-white";

/** "10 Sept 2026, 10:00 am" in school time, for anything the screen dates. */
export function formatIst(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(d);
}
