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
 *
 * 3. ONE COPY OF THE WORDS. The text and the variable ORDER come from the
 *    template registry's seed for the family, never from a second copy kept
 *    here. Until 2026-09-08 this file carried its own four-variable wording
 *    of `bhb_transport_eta` while the registry's seed — the text actually
 *    submitted to Meta — took five in a different order. The moment Meta
 *    approved the seed, every send built here would have been refused for a
 *    parameter-count mismatch, or worse, accepted with the bus number where
 *    the child's name should be.
 */

import type { TransportRoute, TransportStop } from "@/lib/transport";
import { seedTemplateText } from "@/lib/waTemplates";

export type TransportMessageKind =
  | "eta"
  | "delay"
  | "breakdown"
  | "route_change"
  /** Asking the family where their child actually waits for the bus. */
  | "pin_request"
  | "not_boarded"
  | "boarded"
  | "dropped";

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
  /** Registry family — what a sender resolves through resolveTemplateForSend. */
  familyKey: string;
  /** Meta template name. Must be APPROVED on the WABA before it will send. */
  templateName: string;
  language: string;
  /** Ordered body variables ({{1}}, {{2}}, …) in the template's own order. */
  variables: string[];
  /** The same values by registry key, for templateVariablePositions. */
  values: Record<string, string>;
  /** What the parent will read, for the confirm screen. Never sent as text. */
  preview: string;
};

/** Registry family behind each message kind. */
export const TRANSPORT_FAMILIES: Record<TransportMessageKind, string> = {
  eta: "transport_eta",
  delay: "transport_delay",
  breakdown: "transport_breakdown",
  route_change: "transport_route_change",
  pin_request: "transport_pin_request",
  not_boarded: "transport_not_boarded",
  boarded: "transport_boarded",
  dropped: "transport_dropped",
};

/**
 * The plain-English label the transport desk fills in for each registry
 * variable. Labels are what the desk sees; keys are what the template
 * declares. A variable the seed uses that has no label here is a bug the
 * self-test catches, not a hole a parent discovers.
 */
export const TRANSPORT_VARIABLE_LABELS: Record<string, string> = {
  guardianName: "guardian name",
  childName: "child name",
  stopName: "stop name",
  expectedTime: "expected time",
  busNo: "bus",
  minutesLate: "minutes late",
  actionTaken: "what the school is doing",
  effectiveFrom: "from date",
  time: "time at stop",
  // The pickup message's tracking link. Two keys for one token, the same way
  // the fee pay link works: the button carries the token, the body carries
  // the whole URL for a phone whose WhatsApp will not open the button.
  trackToken: "tracking button token",
  trackLink: "tracking link",
};

export type TransportTemplateDef = {
  name: string;
  language: string;
  /** Desk-facing labels, in the template's own variable order. */
  variables: string[];
  /** Registry keys, same order. */
  keys: string[];
  /** Seed body, with {{1}}, {{2}}, … in place of the named variables. */
  body: string;
};

function defFor(kind: TransportMessageKind, language: "en" | "hi"): TransportTemplateDef {
  const seed = seedTemplateText(TRANSPORT_FAMILIES[kind], language);
  if (!seed) {
    throw new Error(`No seed template for ${TRANSPORT_FAMILIES[kind]}`);
  }
  let body = seed.body;
  seed.variables.forEach((key, i) => {
    body = body.split(`{{${key}}}`).join(`{{${i + 1}}}`);
  });
  return {
    name: seed.metaName,
    language,
    keys: seed.variables,
    variables: seed.variables.map((k) => TRANSPORT_VARIABLE_LABELS[k] ?? k),
    body,
  };
}

/**
 * The message set, derived from the registry seeds. Names match templates
 * that must exist and be APPROVED on the WABA; nothing here can invent one,
 * and sending against an unapproved name fails at Meta rather than silently
 * going nowhere.
 */
export const TRANSPORT_TEMPLATES: Record<TransportMessageKind, TransportTemplateDef> = {
  eta: defFor("eta", "en"),
  delay: defFor("delay", "en"),
  breakdown: defFor("breakdown", "en"),
  route_change: defFor("route_change", "en"),
  pin_request: defFor("pin_request", "en"),
  not_boarded: defFor("not_boarded", "en"),
  boarded: defFor("boarded", "en"),
  dropped: defFor("dropped", "en"),
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
  language: "en" | "hi" = "en",
): { ok: true; message: TransportTemplateMessage } | { ok: false; error: string } {
  const def = language === "en" ? TRANSPORT_TEMPLATES[kind] : defFor(kind, language);
  if (!def) return { ok: false, error: `Unknown message kind ${kind}` };

  const variables: string[] = [];
  const byKey: Record<string, string> = {};
  def.keys.forEach((key, i) => {
    const label = def.variables[i]!;
    // Accept the desk label or the registry key; the desk types labels.
    const v = (values[label] ?? values[key] ?? "").trim();
    variables.push(v);
    byKey[key] = v;
  });
  const missing = def.variables.filter((_, i) => !variables[i]);
  if (missing.length) {
    return { ok: false, error: `Missing “${missing[0]}” — nothing sent` };
  }

  let preview = def.body;
  variables.forEach((v, i) => {
    preview = preview.replaceAll(`{{${i + 1}}}`, v);
  });

  return {
    ok: true,
    message: {
      kind,
      familyKey: TRANSPORT_FAMILIES[kind],
      templateName: def.name,
      language: def.language,
      variables,
      values: byKey,
      preview,
    },
  };
}
