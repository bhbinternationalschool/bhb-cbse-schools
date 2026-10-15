"use client";

/**
 * Staff → Requests from the browser: one POST per change to
 * /api/staff/requests (lib/staffRequests.server.ts). "Saved" only on a 200
 * that says ok; anything else is the server's error, word for word.
 */
import { erpFetch } from "@/lib/data/erpFetch";
import type { StaffRequestTicket } from "@/lib/staffHr";
import {
  STAFF_REQUESTS_WRITE_PATH,
  staffRequestFromElement,
  type StaffRequestPost,
  type StaffRequestRow,
} from "@/lib/staffRequestsShared";

export type StaffRequestWriteResult =
  | { ok: true; request: StaffRequestRow | null }
  | { ok: false; status: number | null; error: string; conflict: boolean };

export async function postStaffRequest(body: StaffRequestPost): Promise<StaffRequestWriteResult> {
  let res: Response;
  try {
    res = await erpFetch(STAFF_REQUESTS_WRITE_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: null, error: "Not saved — the server could not be reached. Check the connection and try again.", conflict: false };
  }
  const j = (await res.json().catch(() => null)) as
    | { ok?: boolean; error?: string; request?: unknown }
    | null;
  if (res.ok && j?.ok === true) {
    return { ok: true, request: staffRequestFromElement(j.request) };
  }
  return {
    ok: false,
    status: res.status,
    error: typeof j?.error === "string" && j.error ? j.error : `Not saved — the server answered ${res.status}.`,
    conflict: res.status === 409,
  };
}

/** Raise a request for the signed-in member of staff. */
export function raiseStaffRequest(input: { type: StaffRequestTicket["type"]; subject: string; description: string }) {
  return postStaffRequest({ op: "raise", ...input });
}
