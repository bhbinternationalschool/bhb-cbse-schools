"use client";

/**
 * The survey team from the browser: one POST per change to
 * /api/admissions/survey-team. "Saved" only on a 200 that says ok; anything
 * else is the server's own error, word for word. Nothing is kept here.
 */
import { erpFetch } from "@/lib/data/erpFetch";
import { SURVEY_TEAM_WRITE_PATH, type SurveyTeamOp } from "@/lib/surveyTeamShared";

export type SurveyTeamWrite =
  | { ok: true; id: string; code?: string; expiresAt?: string; name?: string }
  | { ok: false; status: number | null; error: string; conflict: boolean };

export async function postSurveyTeam(body: SurveyTeamOp | { op: "pair_start"; memberId: string }): Promise<SurveyTeamWrite> {
  let res: Response;
  try {
    res = await erpFetch(SURVEY_TEAM_WRITE_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: null, error: "Not saved — the server could not be reached. Check the connection and try again.", conflict: false };
  }
  const j = (await res.json().catch(() => null)) as
    | { ok?: boolean; error?: string; id?: string; code?: string; expiresAt?: string; name?: string }
    | null;
  if (res.ok && j?.ok === true) {
    return { ok: true, id: j.id || "", code: j.code, expiresAt: j.expiresAt, name: j.name };
  }
  return {
    ok: false,
    status: res.status,
    error: typeof j?.error === "string" && j.error ? j.error : `Not saved — the server answered ${res.status}.`,
    conflict: res.status === 409,
  };
}
