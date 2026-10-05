/**
 * A field surveyor's day, proven like the staff punch (director, 5 Oct 2026).
 *
 * Pure: the rules for which step may follow which, the live-GPS check, the
 * bytes a phone signs, and the hours worked. The server (surveyDay.server.ts)
 * does the reading and writing; the surveyor's page (SurveyDayApp) signs.
 *
 * Every step — start, break, resume, end, and each family captured — is
 *  1. signed by the surveyor's registered phone key (one phone, one person);
 *  2. stamped with the phone's live GPS: a fix the browser just took, tight
 *     enough to mean something, never a typed or forwarded map pin;
 *  3. for a surveyor set to start at school, START also needs the gate QR's
 *     rotating code and a fix inside the campus — they reported first.
 */

export type SurveyStartMode = "school" | "field";

export type SurveyDayAction = "start" | "break" | "resume" | "end" | "capture";

export type SurveyFix = { lat: number; lng: number; accuracyM: number; at: string };

export type SurveyDayBreak = {
  startAt: string;
  startGeo: SurveyFix;
  endAt: string | null;
  endGeo: SurveyFix | null;
};

export type SurveyDay = {
  id: string;
  memberKey: string;
  memberName: string;
  staffId: string;
  day: string;
  startMode: SurveyStartMode;
  beatId: string;
  status: "active" | "on_break" | "ended";
  startedAt: string;
  startGeo: SurveyFix;
  endedAt: string | null;
  endGeo: SurveyFix | null;
  breaks: SurveyDayBreak[];
};

/** A field fix rougher than this is a guess about the village, not a place. */
export const SURVEY_MAX_ACCURACY_M = 100;

/** How far a phone's clock may be from the server's when it signs. */
export const SURVEY_SIGN_SKEW_MS = 2 * 60_000;

/** member_key for an outside surveyor; school staff use their staff id. */
export function externalMemberKey(externalId: string): string {
  return `ext:${externalId}`;
}

export function isExternalMemberKey(key: string): boolean {
  return key.startsWith("ext:");
}

/**
 * The exact bytes a phone signs for one step. Who is signing is the key
 * itself — the server maps a registered key to its surveyor. `extra` is the gate code for a
 * school start, the client ref for a capture, the pairing code for a pairing
 * — and "" otherwise — so a signature can't be lifted onto another step.
 */
export function surveyMessage(p: { action: string; extra: string; ts: number }): string {
  return `survey|${p.action}|${p.extra}|${p.ts}`;
}

/**
 * Is this a live fix we can stand on? The browser's own reading, in range,
 * not (0,0), not flagged by the OS as mocked, and accurate to
 * SURVEY_MAX_ACCURACY_M. Anything else is refused with the reason in words
 * the surveyor can act on.
 */
export function checkSurveyFix(
  raw: { lat?: unknown; lng?: unknown; accuracyM?: unknown; mocked?: unknown } | null | undefined,
  nowMs: number,
): { ok: true; fix: SurveyFix } | { ok: false; error: string } {
  const lat = Number(raw?.lat);
  const lng = Number(raw?.lng);
  const acc = Number(raw?.accuracyM);
  if (!raw || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return { ok: false, error: "Allow location for this page — every survey step needs your phone's live location." };
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, error: "That location is not valid. Turn GPS on and try again." };
  }
  if (raw.mocked === true) {
    return { ok: false, error: "A fake-location app is on. Turn it off — survey steps count only with your real location." };
  }
  if (!Number.isFinite(acc) || acc <= 0) {
    return { ok: false, error: "Your phone did not say how precise its location is. Turn on GPS / high-accuracy location and try again." };
  }
  if (acc > SURVEY_MAX_ACCURACY_M) {
    return {
      ok: false,
      error: `Your location is too rough (±${Math.round(acc)} m, needs ±${SURVEY_MAX_ACCURACY_M} m). Turn on GPS, step outside for a moment, and try again.`,
    };
  }
  return {
    ok: true,
    fix: {
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      accuracyM: Math.round(acc),
      at: new Date(nowMs).toISOString(),
    },
  };
}

/**
 * The next state of the day for one step, or why the step is refused.
 * `start` is handled by the caller (it creates the day); the rest move it.
 */
export function applySurveyStep(
  day: SurveyDay | null,
  action: Exclude<SurveyDayAction, "start">,
  fix: SurveyFix,
): { ok: true; day: SurveyDay } | { ok: false; error: string } {
  if (!day) return { ok: false, error: "Start your survey day first." };
  if (day.status === "ended") return { ok: false, error: "Today's survey is already ended." };
  switch (action) {
    case "break":
      if (day.status === "on_break") return { ok: false, error: "You are already on a break — press Resume." };
      return {
        ok: true,
        day: {
          ...day,
          status: "on_break",
          breaks: [...day.breaks, { startAt: fix.at, startGeo: fix, endAt: null, endGeo: null }],
        },
      };
    case "resume": {
      if (day.status !== "on_break") return { ok: false, error: "You are not on a break." };
      const breaks = day.breaks.map((b, i) =>
        i === day.breaks.length - 1 && !b.endAt ? { ...b, endAt: fix.at, endGeo: fix } : b,
      );
      return { ok: true, day: { ...day, status: "active", breaks } };
    }
    case "end": {
      // Ending during a break closes the break at the same moment.
      const breaks = day.breaks.map((b) => (b.endAt ? b : { ...b, endAt: fix.at, endGeo: fix }));
      return { ok: true, day: { ...day, status: "ended", endedAt: fix.at, endGeo: fix, breaks } };
    }
    case "capture":
      if (day.status === "on_break") return { ok: false, error: "You are on a break — press Resume before recording a family." };
      return { ok: true, day };
  }
}

/** Time worked: start to end (or now), less the breaks. */
export function surveyWorkedMs(day: SurveyDay, nowMs: number): number {
  const start = Date.parse(day.startedAt);
  const end = day.endedAt ? Date.parse(day.endedAt) : nowMs;
  let ms = Math.max(0, end - start);
  for (const b of day.breaks) {
    const bs = Date.parse(b.startAt);
    const be = b.endAt ? Date.parse(b.endAt) : end;
    ms -= Math.max(0, Math.min(be, end) - bs);
  }
  return Math.max(0, ms);
}

export function formatWorked(ms: number): string {
  const m = Math.round(ms / 60_000);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/**
 * A Google Maps link through the day's points in order — the route the
 * office looks at. Maps takes a limited number of stops, so a long day keeps
 * its start, its end, and an even spread of the points between.
 */
export function surveyRouteLink(points: { lat: number; lng: number }[], maxStops = 10): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `https://www.google.com/maps?q=${points[0].lat},${points[0].lng}`;
  let pick = points;
  if (points.length > maxStops) {
    const step = (points.length - 1) / (maxStops - 1);
    pick = Array.from({ length: maxStops }, (_, i) => points[Math.round(i * step)]);
  }
  return `https://www.google.com/maps/dir/${pick.map((p) => `${p.lat},${p.lng}`).join("/")}`;
}
