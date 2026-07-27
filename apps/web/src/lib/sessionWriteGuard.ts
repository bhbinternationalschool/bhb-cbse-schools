/**
 * Header-session write lock + active year hint for persistence helpers.
 * AppShell sets this from the header year status; save* helpers reject
 * mutations when a closed academic year is selected.
 */

let activeAy: string | null = null;
let locked = false;

export function setSessionWriteLock(input: {
  academicYearCode: string;
  closed: boolean;
}): void {
  activeAy = input.academicYearCode || null;
  locked = !!input.closed && !!activeAy;
}

/** Header-selected academic year (null before AppShell mounts). */
export function activeSessionCode(): string | null {
  return activeAy;
}

export function isSessionWriteLocked(): boolean {
  return locked;
}

export function lockedSessionCode(): string | null {
  return locked ? activeAy : null;
}

/** Returns false when writes must be blocked (closed session selected). */
export function assertSessionWritable(action = "save"): boolean {
  if (!locked || !activeAy) return true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("bhb-session-readonly", {
        detail: { academicYearCode: activeAy, action },
      }),
    );
  }
  return false;
}
