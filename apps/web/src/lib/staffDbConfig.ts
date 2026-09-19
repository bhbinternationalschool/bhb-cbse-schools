export function staffDualWriteDbEnabled(): boolean {
  const flag = process.env.STAFF_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function staffReadFromDbEnabled(): boolean {
  const flag = (
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_STAFF_READ_FROM_DB
      : process.env.STAFF_READ_FROM_DB
  )?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

/**
 * The masters slices the Staff module owns, not the Masters desk.
 *
 * `pushMastersDeskToDb()` strips these three before writing
 * masters_desk_slices (they live in their own departments / designations /
 * staff tables), so the masters-desk GET always reports them as `[]`. That
 * empty array means "this desk does not carry staff", never "this school has
 * no staff" — a reader that takes it as authoritative wipes the roster.
 * Both the strip and the merge read this list so the two can never drift.
 */
export const STAFF_OWNED_MASTERS_SLICES = [
  "departments",
  "designations",
  "staff",
] as const;
