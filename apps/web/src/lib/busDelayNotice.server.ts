/**
 * Telling one route's families the bus is running late, server-side.
 *
 * Every family gets different words — their own child, their own stop —
 * so this sends one templated message per recipient rather than one
 * payload to many, the same shape as the fee reminder. The approved
 * **Bus running late** utility template carries the delay; free text is
 * never sent, because most parents are outside Meta's 24-hour window and
 * the ones standing at the stop are exactly who must not miss it.
 *
 * Two skips are deliberate and reported rather than silent: a child
 * suspended from boarding is not on the bus today, and a family who sent
 * STOP is not messaged, as everywhere else.
 *
 * There are no quiet hours here. A late bus is time-critical — a parent
 * waiting at a dark stop is the reason this message exists — so unlike a
 * fee chase it is never held back by the hour.
 */

import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureTransportHydratedServer } from "@/lib/transportPersistence";
import { loadTransport, type TransportRoute } from "@/lib/transport";
import { householdWhatsApp, loadSis } from "@/lib/sis";
import { loadMasters } from "@/lib/masters";
import { classLabel } from "@/lib/homework";
import { listOptedOutSet, toE164India } from "@/lib/waContactState.server";
import { sendWaWithFailover, buildWaTemplateBodyComponent } from "@/lib/waSend";
import { matchTransportRoutes } from "@/lib/erpCommands";

export type BusDelayRecipient = {
  householdId: string;
  studentId: string;
  studentName: string;
  classLabel: string;
  stopName: string;
  guardianName: string;
  mobile: string;
};

export type BusDelayPlan = {
  route: TransportRoute;
  routeLabel: string;
  send: BusDelayRecipient[];
  optedOut: number;
  /** Riders suspended from boarding — not on the bus today. */
  suspended: number;
  noMobile: number;
};

export function routeLabelOf(route: TransportRoute): string {
  return [route.busNo ? `Bus ${route.busNo}` : route.code, route.name].filter(Boolean).join(" · ");
}

/**
 * Who would be told, and who would not.
 *
 * Riders are derived exactly as the manifest derives them — live
 * assignments, then the latest academic year that actually has riders —
 * so the confirm card lists the same children the driver's sheet does.
 */
export async function planBusDelayNotice(opts: {
  routeAsked: string;
  academicYearCode: string;
}): Promise<
  | { ok: true; plan: BusDelayPlan }
  | { ok: false; error: "no_match" | "ambiguous"; options: string[] }
> {
  await ensureSchoolMirrorHydrated();
  await ensureTransportHydratedServer();
  const state = loadTransport();
  const routes = (state.routes ?? []).filter((r) => r.isActive !== false);
  const matches = matchTransportRoutes(routes, opts.routeAsked);
  if (matches.length !== 1) {
    return {
      ok: false,
      error: matches.length ? "ambiguous" : "no_match",
      options: (matches.length ? matches : routes).slice(0, 10).map(routeLabelOf),
    };
  }
  const route = matches[0]!;

  const sis = loadSis();
  const masters = loadMasters();
  const live = (state.assignments ?? []).filter(
    (a) => a.routeId === route.id && a.effectiveTo == null,
  );
  const ay =
    live.map((a) => a.academicYearCode).filter(Boolean).sort().pop() || opts.academicYearCode;
  const riders = live.filter((a) => a.academicYearCode === ay);
  const stopName = new Map((route.stops ?? []).map((s) => [s.id, s.name]));
  const byId = new Map(sis.students.map((st) => [st.id, st]));

  let suspended = 0;
  let noMobile = 0;
  const candidates: BusDelayRecipient[] = [];
  for (const a of riders) {
    if (a.boardingSuspended) {
      suspended += 1;
      continue;
    }
    const st = byId.get(a.studentId);
    if (!st || st.status !== "active") continue;
    const hh = sis.households.find((h) => h.id === (a.householdId || st.householdId));
    const mobile = hh ? householdWhatsApp(hh) || hh.mobile || "" : "";
    if (!hh || !mobile) {
      noMobile += 1;
      continue;
    }
    candidates.push({
      householdId: hh.id,
      studentId: st.id,
      studentName: st.fullName,
      classLabel: classLabel(masters, st.classId, st.sectionId).replace(" · ", " "),
      stopName: stopName.get(a.stopId) || "",
      guardianName: hh.guardianName || "",
      mobile,
    });
  }

  const optedOutSet = await listOptedOutSet(candidates.map((c) => c.mobile)).catch(
    () => new Set<string>(),
  );
  const send: BusDelayRecipient[] = [];
  let optedOut = 0;
  for (const c of candidates) {
    if (optedOutSet.has(toE164India(c.mobile))) optedOut += 1;
    else send.push(c);
  }
  send.sort(
    (a, b) => a.stopName.localeCompare(b.stopName) || a.studentName.localeCompare(b.studentName),
  );

  return {
    ok: true,
    plan: { route, routeLabel: routeLabelOf(route), send, optedOut, suspended, noMobile },
  };
}

export type BusDelaySendResult = {
  sent: number;
  failed: number;
  errors: string[];
};

export async function sendBusDelayNotices(opts: {
  recipients: BusDelayRecipient[];
  busNo: string;
  minutesLate: number;
  template: { metaName: string; language: string; variables: string[] };
  /** Distinguishes a second notice on the same route from a retry of the first. */
  noticeKey: string;
}): Promise<BusDelaySendResult> {
  const out: BusDelaySendResult = { sent: 0, failed: 0, errors: [] };
  for (const r of opts.recipients) {
    const vars: Record<string, string> = {
      guardianName: r.guardianName || "Parent",
      childName: r.studentName,
      busNo: opts.busNo,
      stopName: r.stopName || "the stop",
      minutesLate: String(opts.minutesLate),
    };
    const res = await sendWaWithFailover({
      primaryMobile: r.mobile,
      template: {
        name: opts.template.metaName,
        language: opts.template.language,
        components: [buildWaTemplateBodyComponent(opts.template.variables, vars)],
      },
      clientMessageId: `busdelay_${opts.noticeKey}_${r.householdId}`,
    });
    if (res.ok) out.sent += 1;
    else {
      out.failed += 1;
      if (res.error && out.errors.length < 3) out.errors.push(res.error);
    }
  }
  return out;
}
