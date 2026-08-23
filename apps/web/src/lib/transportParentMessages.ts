/**
 * What the school tells parents about the bus, and how.
 *
 * Two hard constraints shape everything here.
 *
 * 1. TEMPLATES ONLY. Meta allows free-form WhatsApp only inside a 24-hour
 *    window opened by the parent writing first. Every proactive message —
 *    an ETA, a delay, a breakdown — falls outside it. The Fleet Edge alert
 *    path learned this the expensive way: 223 notifications, every one
 *    failed, all with "Outside Meta's 24h session window". So each message
 *    kind below names an approved template and supplies its variables; there
 *    is no free-text path, because a free-text path would silently fail.
 *
 * 2. THE ETA IS SCHEDULED, NOT LIVE. Tata Fleet Edge is pushing periodic
 *    summaries and alerts but not the Basic Push telemetry feed, so there is
 *    no live position to compute from. What can honestly be offered is the
 *    planned arrival: the route's MEASURED round trip, spread across its
 *    stops in sequence. Every message that carries one says "expected", and
 *    a route whose round trip was never measured produces no ETA at all
 *    rather than a plausible guess — a parent standing at a stop on the
 *    strength of an invented time is the failure this avoids.
 */

import type { TransportRoute, TransportStop } from "@/lib/transport";

export type TransportMessageKind =
  | "eta"
  | "delay"
  | "breakdown"
  | "route_change"
  | "not_boarded";

export type StopEta = {
  stopId: string;
  stopName: string;
  sequence: number;
  /** "HH:mm", or null when it cannot be worked out. */
  expectedAt: string | null;
  /** Minutes from departure. Null when unknown. */
  minutesFromStart: number | null;
  reason: string;
};

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

function toHhMm(total: number): string {
  const wrapped = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Planned arrival at each stop on a morning run.
 *
 * The only measured quantity available is the round trip, so the outbound leg
 * is taken as half of it and spread across the stops in proportion to how far
 * each is from school — the far stops are collected first on the way out.
 * That is an approximation and is labelled as one everywhere it surfaces.
 *
 * Refuses, rather than estimates, when the round trip has never been measured
 * or when stops carry no distances. Both are the same judgement the afternoon
 * planner makes: ten minutes of optimism leaves a child at a roadside.
 */
export function buildStopEtas(
  route: TransportRoute,
  departureTime: string,
): StopEta[] {
  const stops = [...route.stops].sort((a, b) => a.sequence - b.sequence);
  const start = toMinutes(departureTime);
  const roundTrip =
    route.roundTripMinutes && route.roundTripMinutes > 0
      ? route.roundTripMinutes
      : null;

  const blank = (s: TransportStop, reason: string): StopEta => ({
    stopId: s.id,
    stopName: s.name,
    sequence: s.sequence,
    expectedAt: null,
    minutesFromStart: null,
    reason,
  });

  if (start == null) {
    return stops.map((s) => blank(s, "No departure time set for this run"));
  }
  if (roundTrip == null) {
    return stops.map((s) =>
      blank(
        s,
        "This route has never been measured — run “Suggest order” on it before promising a time",
      ),
    );
  }

  const measured = stops.filter((s) => s.distanceKm > 0);
  if (measured.length === 0) {
    return stops.map((s) => blank(s, "No stop on this route has a measured distance"));
  }

  // Outbound leg. The bus leaves school, drives to the furthest stop, and
  // collects inwards — so time from departure tracks how far out the stop is.
  const outbound = roundTrip / 2;
  const furthest = Math.max(...measured.map((s) => s.distanceKm));

  return stops.map((s) => {
    if (s.distanceKm <= 0) {
      return blank(s, "This stop has no measured distance");
    }
    // The furthest stop is reached at the end of the outbound leg; nearer
    // stops are collected on the way back in.
    const share = furthest > 0 ? (furthest - s.distanceKm) / furthest : 0;
    const mins = Math.round(outbound + share * outbound);
    return {
      stopId: s.id,
      stopName: s.name,
      sequence: s.sequence,
      expectedAt: toHhMm(start + mins),
      minutesFromStart: mins,
      reason: "",
    };
  });
}

export type TransportTemplateMessage = {
  kind: TransportMessageKind;
  /** Meta template name. Must be APPROVED on the WABA before it will send. */
  templateName: string;
  language: string;
  /** Ordered body variables ({{1}}, {{2}}, …). */
  variables: string[];
  /** What the parent will read, for the confirm screen. Never sent as text. */
  preview: string;
};

/**
 * The message set. Names match templates that must exist and be APPROVED on
 * the WABA; nothing here can invent one, and sending against an unapproved
 * name fails at Meta rather than silently going nowhere.
 */
export const TRANSPORT_TEMPLATES: Record<
  TransportMessageKind,
  { name: string; language: string; variables: string[]; body: string }
> = {
  eta: {
    name: "bhb_transport_eta",
    language: "en",
    variables: ["child name", "stop name", "expected time", "bus"],
    body: "Namaste. {{1}}'s school bus {{4}} is expected at {{2}} at about {{3}}. This is the scheduled time, not a live position.",
  },
  delay: {
    name: "bhb_transport_delay",
    language: "en",
    variables: ["child name", "stop name", "minutes late", "bus"],
    body: "Namaste. Bus {{4}} is running about {{3}} minutes late for {{2}}. {{1}} will be picked up as soon as it arrives.",
  },
  breakdown: {
    name: "bhb_transport_breakdown",
    language: "en",
    variables: ["child name", "bus", "what the school is doing"],
    body: "Namaste. Bus {{2}} has broken down. {{1}} is safe with the attendant. {{3}}",
  },
  route_change: {
    name: "bhb_transport_route_change",
    language: "en",
    variables: ["child name", "new stop", "from date", "bus"],
    body: "Namaste. From {{3}}, {{1}} will be picked up at {{2}} by bus {{4}}. Please contact the school office if this does not suit.",
  },
  not_boarded: {
    name: "bhb_transport_not_boarded",
    language: "en",
    variables: ["child name", "stop name", "time"],
    body: "Namaste. {{1}} did not board the bus at {{2}} at {{3}}. Please let the school know if they are travelling separately today.",
  },
};

/**
 * Build one parent message.
 *
 * Refuses when a variable is missing rather than sending a sentence with a
 * hole in it. "Your child is expected at at about" is worse than no message:
 * it is a message the parent will act on and then complain about.
 */
export function buildTransportMessage(
  kind: TransportMessageKind,
  values: Record<string, string>,
): { ok: true; message: TransportTemplateMessage } | { ok: false; error: string } {
  const def = TRANSPORT_TEMPLATES[kind];
  if (!def) return { ok: false, error: `Unknown message kind ${kind}` };

  const variables: string[] = [];
  for (const label of def.variables) {
    const v = (values[label] ?? "").trim();
    if (!v) {
      return { ok: false, error: `Missing “${label}” — nothing sent` };
    }
    variables.push(v);
  }

  let preview = def.body;
  variables.forEach((v, i) => {
    preview = preview.replaceAll(`{{${i + 1}}}`, v);
  });

  return {
    ok: true,
    message: {
      kind,
      templateName: def.name,
      language: def.language,
      variables,
      preview,
    },
  };
}
