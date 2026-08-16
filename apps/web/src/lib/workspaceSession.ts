/**
 * Keep the session cookie in step with the academic year the SERVER resolves.
 *
 * The browser no longer decides what year it is. This module used to read the
 * local masters copy, call `currentAcademicYearCode()`, and PATCH the result
 * to the server. On a desk holding no academic years that call returns
 * DEFAULT_AY ("2025-26"), so on 2026-08-10 a frozen browser fabricated a year,
 * wrote it into the signed server cookie, and the school ran inside a session
 * that had ended on 2026-03-31 — every scoped query with it.
 *
 * Now it only relays. `GET /api/session/ay` answers from the calendar against
 * Masters in the database (lib/academicYearResolve.ts); if the cookie
 * disagrees, this asks the server to adopt the server's own answer. A browser
 * with an empty desk, a skewed clock, or stale storage has nothing to
 * contribute and therefore cannot do any harm.
 */

export const WORKSPACE_AY_ALIGNED_KEY = "bhb_workspace_ay_aligned_v1";

export function clearWorkspaceSessionAlignFlag(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(WORKSPACE_AY_ALIGNED_KEY);
}

// Multiple hydration-completion events (bhb-masters-updated,
// bhb-desk-hydrated, ...) can each fire within milliseconds of one another
// on a single navigation, and every listener that calls this function has
// no way to know another call is already in flight. Without de-duping,
// concurrent calls each independently GET /api/session/ay and, if either
// server round trip is answered from a momentarily inconsistent read, can
// each independently PATCH — a race that only widens the window for the
// header selector and page data to disagree, exactly the symptom this
// module's fix history (see the file header) has chased twice already.
let inFlight: Promise<boolean> | null = null;

/** Sync the session cookie when it differs from the server-resolved year. */
export async function alignWorkspaceSessionFromMasters(
  cookieAy: string,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (inFlight) return inFlight;
  inFlight = runAlign(cookieAy).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runAlign(cookieAy: string): Promise<boolean> {
  let resolved: string | null = null;
  let matches = false;
  try {
    const res = await fetch("/api/session/ay", { cache: "no-store" });
    if (!res.ok) return false;
    const body = (await res.json()) as {
      resolved?: string | null;
      matches?: boolean;
    };
    resolved = body.resolved ?? null;
    matches = !!body.matches;
  } catch {
    // Offline or a failed request. Leave the session alone: an unanswered
    // question is not evidence the cookie is wrong.
    return false;
  }

  // No usable year in Masters. A setup task, and never grounds for the client
  // to invent one.
  if (!resolved) return false;

  if (matches || resolved === cookieAy) {
    sessionStorage.setItem(WORKSPACE_AY_ALIGNED_KEY, "1");
    return false;
  }

  const ok = await fetch("/api/session/ay", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ academicYearCode: resolved }),
  })
    .then((r) => r.ok)
    .catch(() => false);

  if (ok) sessionStorage.setItem(WORKSPACE_AY_ALIGNED_KEY, "1");
  return ok;
}

/** Core desk + staff hydrate, then align the session to the server's year. */
export async function bootstrapWorkspaceSession(
  pathname: string,
  cookieAy: string,
): Promise<"ready" | "refresh"> {
  if (typeof window === "undefined") return "ready";

  const { ensureDeskHydratedPriority } = await import(
    "@/lib/schoolDataMirrorClientHydrate"
  );
  const { ensureStaffHydrated } = await import("@/lib/staffPersistence");

  await ensureDeskHydratedPriority(pathname);
  await ensureStaffHydrated();

  // No longer gated on isDeskHydrated("masters"): the answer comes from the
  // server, so whether this browser managed to hydrate its own copy is
  // irrelevant. That gate is also why the aligner never ran on a frozen desk —
  // the devices that most needed correcting were the ones it skipped.
  const changed = await alignWorkspaceSessionFromMasters(cookieAy);
  return changed ? "refresh" : "ready";
}
