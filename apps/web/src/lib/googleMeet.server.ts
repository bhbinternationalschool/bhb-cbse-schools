import "server-only";

/**
 * Google Meet REST API v2, on a staff member's own Google grant.
 *
 * Two calls only. `createMeetSpace` makes a room the teacher owns (so they
 * are its host, can admit, mute and end it) without touching their
 * calendar; `listMeetParticipants` reads who was in it afterwards, for the
 * attendance sync. Both need the Meet API enabled on the OAuth client's
 * GCP project, and the meetings.space.* scopes — a grant made before those
 * scopes existed answers 403 and the caller tells the teacher to reconnect.
 */

import {
  getStaffConnection,
  type ClassroomStaffConnection,
} from "@/lib/googleClassroom.store.server";
import { ensureAccessToken } from "@/lib/googleClassroom.server";
import { scopesAllowMeet } from "@/lib/googleOAuth.server";

const MEET_BASE = "https://meet.googleapis.com/v2";

export type MeetSpace = {
  /** Resource name, spaces/xxxx — keep, it is how participants are read. */
  name: string;
  meetingUri: string;
  meetingCode: string;
};

export type MeetParticipant = {
  displayName: string;
  /** Google account email when the joiner was signed in and the API says so. */
  email: string;
  kind: "signed_in" | "anonymous" | "phone";
  earliestStartTime: string;
  latestEndTime: string;
  minutes: number;
};

type Ok<T> = { ok: true; value: T };
type Fail = { ok: false; error: string; reconnect?: boolean };

async function tokenFor(
  staffKey: string,
): Promise<Ok<{ accessToken: string; conn: ClassroomStaffConnection }> | Fail> {
  const conn = await getStaffConnection(staffKey);
  if (!conn) {
    return { ok: false, error: "Google is not connected for this teacher", reconnect: true };
  }
  // A grant from before the Meet scopes were added is recognisable: it
  // carries a scope string without meetings.space.created. Legacy disk rows
  // have '' and are given the benefit of the doubt — Google will 403 them.
  if (conn.scopes && !scopesAllowMeet(conn.scopes)) {
    return {
      ok: false,
      error: "This Google connection predates Meet access — reconnect Google once",
      reconnect: true,
    };
  }
  const t = await ensureAccessToken(conn);
  if (!t.ok) return { ok: false, error: t.error, reconnect: true };
  return { ok: true, value: { accessToken: t.accessToken, conn: t.connection } };
}

async function meetFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Ok<T> | Fail> {
  try {
    const res = await fetch(`${MEET_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    const json = (await res.json().catch(() => ({}))) as T & {
      error?: { message?: string; status?: string };
    };
    if (!res.ok) {
      const msg = json.error?.message || `Meet HTTP ${res.status}`;
      return {
        ok: false,
        error: msg,
        reconnect: res.status === 401 || res.status === 403,
      };
    }
    return { ok: true, value: json };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Meet request failed",
    };
  }
}

/**
 * Create a Meet room owned by this staff member. `OPEN` access lets anyone
 * with the link in without knocking — a class of thirty children cannot
 * each wait to be admitted — and the teacher can still tighten it from
 * inside the call.
 */
export async function createMeetSpace(
  staffKey: string,
): Promise<Ok<MeetSpace> | Fail> {
  const t = await tokenFor(staffKey);
  if (!t.ok) return t;
  const r = await meetFetch<{
    name?: string;
    meetingUri?: string;
    meetingCode?: string;
  }>(t.value.accessToken, "/spaces", {
    method: "POST",
    body: JSON.stringify({
      config: { accessType: "OPEN", entryPointAccess: "ALL" },
    }),
  });
  if (!r.ok) return r;
  if (!r.value.meetingUri) {
    return { ok: false, error: "Meet returned no meeting link" };
  }
  return {
    ok: true,
    value: {
      name: r.value.name || "",
      meetingUri: r.value.meetingUri,
      meetingCode: r.value.meetingCode || "",
    },
  };
}

type ConferenceRecord = { name: string; startTime?: string; endTime?: string };
type ParticipantRow = {
  name: string;
  signedinUser?: { user?: string; displayName?: string };
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
  earliestStartTime?: string;
  latestEndTime?: string;
};

function minutesBetween(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return ms > 0 ? Math.round(ms / 60_000) : 0;
}

/**
 * Everyone who was in the room, across every conference held in the space
 * (a teacher who drops and rejoins starts a second conference record).
 * The Meet API does not expose a signed-in user's email on this endpoint;
 * matching to students is by display name, and the caller treats it as a
 * hint, never as a mark.
 */
export async function listMeetParticipants(
  staffKey: string,
  spaceName: string,
): Promise<Ok<MeetParticipant[]> | Fail> {
  if (!spaceName) return { ok: false, error: "No Meet space on this class" };
  const t = await tokenFor(staffKey);
  if (!t.ok) return t;
  const filter = encodeURIComponent(`space.name = "${spaceName}"`);
  const recs = await meetFetch<{ conferenceRecords?: ConferenceRecord[] }>(
    t.value.accessToken,
    `/conferenceRecords?filter=${filter}&pageSize=50`,
  );
  if (!recs.ok) return recs;
  const out: MeetParticipant[] = [];
  for (const rec of recs.value.conferenceRecords || []) {
    let pageToken = "";
    do {
      const page = await meetFetch<{
        participants?: ParticipantRow[];
        nextPageToken?: string;
      }>(
        t.value.accessToken,
        `/${rec.name}/participants?pageSize=100${
          pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""
        }`,
      );
      if (!page.ok) return page;
      for (const p of page.value.participants || []) {
        const kind: MeetParticipant["kind"] = p.signedinUser
          ? "signed_in"
          : p.phoneUser
            ? "phone"
            : "anonymous";
        out.push({
          displayName:
            p.signedinUser?.displayName ||
            p.anonymousUser?.displayName ||
            p.phoneUser?.displayName ||
            "",
          email: "",
          kind,
          earliestStartTime: p.earliestStartTime || "",
          latestEndTime: p.latestEndTime || "",
          minutes: minutesBetween(p.earliestStartTime, p.latestEndTime),
        });
      }
      pageToken = page.value.nextPageToken || "";
    } while (pageToken);
  }
  return { ok: true, value: out };
}
