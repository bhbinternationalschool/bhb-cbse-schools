/**
 * Whether this browser knows enough to decide what a person may open.
 *
 * Two things feed every client permission check: the rbac slice (roles,
 * assignments, per-person grants) and the staff roster (masters.staff, for
 * the designation fallback). Since module data became memory-only (#526)
 * both arrive after the page has drawn; a check made before then used to
 * answer from the built-in defaults and the designation alone, so the office
 * — assigned the office role, designated "Computer Operator" — saw Comms
 * without App pop-ups or Parents on app (12 Oct 2026).
 *
 * The rule: until both have loaded the answer is "loading", never "no"; if
 * loading was tried and did not land, it is "failed" (the screen says it
 * could not check and offers a retry), still never "no".
 */

export type AccessDataStatus = "loading" | "ready" | "failed";

export function accessDataStatus(input: {
  /** The server copy exists (Supabase configured). Off = this browser is the truth. */
  remote: boolean;
  /** The page has rendered on the client (server render always waits). */
  mounted: boolean;
  rbacLoaded: boolean;
  rosterLoaded: boolean;
  /** This page's load attempt for both has finished (landed or not). */
  attemptSettled: boolean;
}): AccessDataStatus {
  if (!input.mounted) return "loading";
  if (!input.remote) return "ready";
  if (input.rbacLoaded && input.rosterLoaded) return "ready";
  return input.attemptSettled ? "failed" : "loading";
}

/** A permission answer that can be "not known yet" — never a silent no. */
export type AccessVerdict = "allowed" | "denied" | "loading" | "failed";

export function accessVerdict(
  status: AccessDataStatus,
  decide: () => boolean,
): AccessVerdict {
  if (status !== "ready") return status;
  return decide() ? "allowed" : "denied";
}
