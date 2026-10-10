/** Push desk/blob changes to Supabase immediately after local save. */
export const DESK_PUSH_DEBOUNCE_MS = 0;

/**
 * Auto logout after this much idle time (ms) — THIRTY minutes, by the
 * director's standing instruction of 2026-09-06.
 *
 * It was five. At the counter that meant a sign-out every time a parent took
 * a few minutes over a receipt, and each sign-in re-minted the session — on
 * that day in the wrong academic year, so the office saw students and
 * accounts "jump" (see resolveLoginAcademicYearCode). Thirty minutes is the
 * floor for every session kind (staff, parent, field); the self-test
 * workspaceSyncPolicy.selftest.ts pins it so a refactor cannot quietly put
 * it back. Shorten it only with the director's say-so, and change the test
 * in the same commit.
 */
export const WORKSPACE_INACTIVITY_MIN_MINUTES = 30;
export const WORKSPACE_INACTIVITY_MS = WORKSPACE_INACTIVITY_MIN_MINUTES * 60 * 1000;

export const FRESH_LOGIN_SESSION_KEY = "bhb_workspace_fresh_login_v1";
