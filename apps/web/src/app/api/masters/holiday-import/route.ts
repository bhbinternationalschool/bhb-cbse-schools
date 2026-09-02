/**
 * Propose next session's holidays from Google's India calendar.
 *
 * Read-only, and it publishes nothing. It returns DRAFTS for a person to
 * confirm in Masters, because a school closes for the holidays it chooses,
 * not for everything the country lists. Attendance and payroll both read the
 * holiday calendar, so a wrong row marks children absent on a working day and
 * pays staff for a holiday they worked.
 *
 * Needs `masters:edit` — it is the first step of changing the school
 * calendar, even though the writing happens later, on the desk.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { mapGoogleHolidays, type GoogleHolidayEvent } from "@/lib/holidayImport";

export const runtime = "nodejs";

/** Google's public holiday calendar for India. */
const INDIA_HOLIDAY_CALENDAR = "en.indian#holiday@group.v.calendar.google.com";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "masters", "edit");
  if (!auth.ok) return auth.response;

  const key = process.env.GOOGLE_CALENDAR_API_KEY ?? "";
  if (!key) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No Google Calendar API key is configured. Add GOOGLE_CALENDAR_API_KEY (Calendar API enabled) and try again.",
      },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json(
      { ok: false, error: "Give the session as from=YYYY-MM-DD&to=YYYY-MM-DD" },
      { status: 400 },
    );
  }
  if (to < from) {
    return NextResponse.json(
      { ok: false, error: "The end of the session is before its start" },
      { status: 400 },
    );
  }

  const api = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      INDIA_HOLIDAY_CALENDAR,
    )}/events`,
  );
  api.searchParams.set("key", key);
  api.searchParams.set("singleEvents", "true");
  api.searchParams.set("orderBy", "startTime");
  api.searchParams.set("maxResults", "250");
  // The window is inclusive of the session's last day; Google's timeMax is
  // exclusive, so it is pushed one day out.
  api.searchParams.set("timeMin", `${from}T00:00:00Z`);
  api.searchParams.set("timeMax", `${to}T23:59:59Z`);

  let events: GoogleHolidayEvent[] = [];
  try {
    const res = await fetch(api.toString(), { cache: "no-store" });
    const body = (await res.json()) as {
      items?: GoogleHolidayEvent[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: body?.error?.message || `Google refused the request (${res.status})`,
        },
        { status: 502 },
      );
    }
    events = Array.isArray(body.items) ? body.items : [];
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not reach Google" },
      { status: 502 },
    );
  }

  const plan = mapGoogleHolidays(events, { from, to });
  return NextResponse.json({
    ok: true,
    fetched: events.length,
    ...plan,
    // Said plainly in the response, because the caller is about to show these
    // to someone who will decide whether the school shuts.
    note:
      "Proposals only. Google's India feed carries no state field, so anything naming another state is filtered out by name — check the list before publishing. Nothing here is published until you publish it.",
  });
}
