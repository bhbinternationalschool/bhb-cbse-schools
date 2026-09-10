/**
 * "Where is my child's bus?" — resolving it (server-only).
 *
 * Walks child → transport assignment → vehicle → last Fleet Edge fix, then
 * hands each result to parentPositionVerdict(), which decides whether a
 * family may be told. Nothing here decides that; this module only gathers.
 *
 * One household can produce more than one answer: siblings on different
 * routes each get their own bus, because collapsing them would tell a parent
 * about a vehicle their other child is not on.
 */
import "server-only";

import {
  parentPositionVerdict,
  positionAgeLabel,
  mapsLink,
  vehicleMotion,
  type LivePosition,
} from "@/lib/fleetLivePosition";
import { readLiveVehiclePositions } from "@/lib/fleetLivePosition.server";
import { normalizeVehicleKey } from "@/lib/fleetEdgeLink";
import {
  composeBusFoundReply,
  composeBusUnavailableReply,
  joinBusReplies,
  wantsHindi,
} from "@/lib/parentBusReply";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
import { loadTransport, type TransportState } from "@/lib/transport";
import { studentTransportSummary } from "@/lib/transportForStudent";
import { composeBusCheckFailedReply } from "@/lib/parentBusReply";

const MOTION_LABEL_EN: Record<ReturnType<typeof vehicleMotion>, string> = {
  moving: "Moving",
  idling: "Stopped, engine on",
  parked: "Parked",
  unknown: "Position known, motion unclear",
};

const MOTION_LABEL_HI: Record<ReturnType<typeof vehicleMotion>, string> = {
  moving: "चल रही है",
  idling: "रुकी है, इंजन चालू",
  parked: "खड़ी है",
  unknown: "लोकेशन मिली, चाल स्पष्ट नहीं",
};

export type BusLocationChild = { id: string; name: string };

/**
 * The transport desk, read from the database.
 *
 * `loadTransport()` alone is browser state: on the server it returns an empty
 * state, and every child then looks like they have no bus. That is exactly
 * how this first behaved — a real Magic-1 rider was told "no school
 * transport". The desk rows live in transport_desk_slices and must be read
 * from there.
 *
 * Cached for a minute because the welcome text asks the same question on
 * every stray "hi", and the desk changes a few times a term.
 */
const DESK_TTL_MS = 60_000;
let deskCache: { at: number; state: TransportState | null } | null = null;

async function readDeskState(): Promise<TransportState | null> {
  const now = Date.now();
  if (deskCache && now - deskCache.at < DESK_TTL_MS) return deskCache.state;

  const { fetchTransportDeskFromDb } = await import("@/lib/transportNormalized.server");
  const { mergeDbDeskIntoTransportState } = await import("@/lib/transportNormalizedMerge");
  const desk = await fetchTransportDeskFromDb();

  // ok:false means the read failed — NOT that the school has no buses. The
  // difference decides whether a parent is told "you have no transport".
  const state = desk.ok
    ? mergeDbDeskIntoTransportState(loadTransport(), desk.bundle, { preferDb: true })
    : null;
  deskCache = { at: now, state };
  return state;
}

/** Does anyone in this household ride? Used to decide whether to offer BUS. */
export async function householdRidesTheBus(
  children: BusLocationChild[],
): Promise<boolean> {
  if (children.length === 0) return false;
  try {
    const state = await readDeskState();
    if (!state) return false;
    const ay = currentAcademicYearCode(loadMasters());
    return children.some(
      (c) => studentTransportSummary(c.id, state, { academicYearCode: ay }).assigned,
    );
  } catch {
    return false;
  }
}

/**
 * Build the reply for one household.
 *
 * `escalate` is returned true only where a person genuinely has to pick the
 * thread up — a child with no transport on record, a vehicle with no tracker,
 * a fix too old to trust. A bus simply not running is not an escalation; it
 * is the expected answer at 8pm.
 */
export async function busLocationReplyForHousehold(opts: {
  children: BusLocationChild[];
  rawText: string;
}): Promise<{ text: string; escalate: boolean }> {
  const hindi = wantsHindi(opts.rawText);

  if (opts.children.length === 0) {
    return {
      escalate: true,
      text: composeBusUnavailableReply("no-vehicle", { busLabel: "", childName: "" }, hindi),
    };
  }

  const state = await readDeskState();
  if (!state) {
    // Read failed. Saying "no transport" here would tell a bus family they
    // have no bus, which is worse than admitting we cannot look right now.
    return { escalate: true, text: composeBusCheckFailedReply(hindi) };
  }
  const ay = currentAcademicYearCode(loadMasters());

  const live = await readLiveVehiclePositions();
  const byKey = new Map<string, LivePosition>();
  if (live.ok) {
    for (const p of live.positions) {
      // Either key: the desk holds a chassis where a registration belongs on
      // two of the six vehicles, and a plate-only match drops them.
      for (const k of [normalizeVehicleKey(p.vehicleRef), normalizeVehicleKey(p.registrationNumber)]) {
        if (k && !byKey.has(k)) byKey.set(k, p.position);
      }
    }
  }

  const nowMs = Date.now();
  const showChildName = opts.children.length > 1;
  const parts: string[] = [];
  const seenRoutes = new Set<string>();
  let escalate = false;

  for (const child of opts.children) {
    const summary = studentTransportSummary(child.id, state, { academicYearCode: ay });

    if (!summary.assigned) {
      parts.push(
        composeBusUnavailableReply(
          "no-vehicle",
          { busLabel: "", childName: showChildName ? child.name : "" },
          hindi,
        ),
      );
      escalate = true;
      continue;
    }

    // Siblings on the same route get one answer, not two identical ones.
    if (seenRoutes.has(summary.routeId)) continue;
    seenRoutes.add(summary.routeId);

    const busLabel = summary.busNo || summary.routeName || summary.routeCode || summary.vehicleReg;
    const childName = showChildName ? child.name : "";
    const position = byKey.get(normalizeVehicleKey(summary.vehicleReg)) ?? null;
    const verdict = parentPositionVerdict({ position, hasVehicle: true, nowMs });

    if (!verdict.share) {
      parts.push(composeBusUnavailableReply(verdict.reason, { busLabel, childName }, hindi));
      // "Not running" is the correct answer in the evening, not a problem for
      // the office to solve.
      if (verdict.reason !== "off-trip") escalate = true;
      continue;
    }

    const motion = vehicleMotion(verdict.position);
    parts.push(
      composeBusFoundReply(
        {
          busLabel,
          childName,
          motionLabel: (hindi ? MOTION_LABEL_HI : MOTION_LABEL_EN)[motion],
          speedKmh: verdict.position.speed,
          ageLabel: positionAgeLabel(verdict.position.at, nowMs),
          mapsUrl: mapsLink(verdict.position),
        },
        hindi,
      ),
    );
  }

  return { text: joinBusReplies(parts), escalate };
}
