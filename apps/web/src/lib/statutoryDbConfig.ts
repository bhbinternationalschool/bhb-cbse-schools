/**
 * Unlike payroll (whose desk tables already exist in production),
 * statutory_desk_* tables only exist once the paired migration below has been
 * applied. Defaulting dual-write to "on" before that would make every
 * payroll post fail against a table that doesn't exist yet — so both flags
 * default OFF here and must be explicitly opted into after the migration is
 * confirmed applied.
 */
export function statutoryDualWriteDbEnabled(): boolean {
  return (
    (process.env.STATUTORY_DUAL_WRITE_DB || "").trim().toLowerCase() === "true"
  );
}

export function statutoryReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_STATUTORY_READ_FROM_DB === "true";
  }
  return process.env.STATUTORY_READ_FROM_DB === "true";
}
