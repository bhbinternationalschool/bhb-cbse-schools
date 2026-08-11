/**
 * Fleet driver WhatsApp quick replies (route, students, breakdown).
 */

import { loadTransport } from "@/lib/transport";
import { TENANT } from "@/lib/types";
import { generateTutorText } from "@/lib/aiLlm.server";

export type TransportBotQuickId =
  | "route"
  | "students"
  | "breakdown"
  | "human"
  | "menu";

export type TransportDriverContext = {
  driverName: string;
  vehicleReg: string;
  vehicleName: string;
  routeName: string;
  studentCount: number;
};

export const TRANSPORT_BOT_PROMPTS: {
  id: TransportBotQuickId;
  label: string;
  waKeyword: string;
}[] = [
  { id: "route", label: "My route", waKeyword: "ROUTE" },
  { id: "students", label: "Students on bus", waKeyword: "STUDENTS" },
  { id: "breakdown", label: "Breakdown / delay", waKeyword: "BREAKDOWN" },
  { id: "human", label: "Talk to transport desk", waKeyword: "HUMAN" },
  { id: "menu", label: "Main menu", waKeyword: "MENU" },
];

export function resolveTransportDriverContext(
  mobile10: string,
): TransportDriverContext | null {
  const m = mobile10.replace(/\D/g, "").slice(-10);
  if (m.length !== 10) return null;
  const transport = loadTransport();
  const vehicle = transport.vehicles.find((v) => {
    const dm = (v.driverMobile || "").replace(/\D/g, "").slice(-10);
    return dm === m && v.isActive;
  });
  if (!vehicle) return null;
  const route =
    transport.routes.find((r) => r.id === vehicle.primaryRouteId) || null;
  const studentCount = transport.assignments.filter(
    (a) =>
      a.routeId === vehicle.primaryRouteId &&
      !a.boardingSuspended &&
      !a.effectiveTo,
  ).length;
  return {
    driverName: vehicle.driverName || "Driver",
    vehicleReg: vehicle.registrationNo,
    vehicleName: vehicle.name,
    routeName: route?.name || "Not assigned",
    studentCount,
  };
}

export function detectTransportBotIntent(
  text: string,
): TransportBotQuickId | "unknown" {
  const upper = (text || "").trim().toUpperCase();
  for (const q of TRANSPORT_BOT_PROMPTS) {
    if (upper === q.waKeyword || upper.startsWith(`${q.waKeyword} `)) {
      return q.id;
    }
  }
  const low = (text || "").toLowerCase();
  if (/route|pickup|drop|stop/.test(low)) return "route";
  if (/student|kid|count|boarding/.test(low)) return "students";
  if (/break|delay|accident|stuck|problem/.test(low)) return "breakdown";
  if (/human|help|call|office/.test(low)) return "human";
  if (/menu|start|hello|hi/.test(low)) return "menu";
  return "unknown";
}

export function replyTransportBotIntent(
  intent: TransportBotQuickId | "unknown",
  ctx: TransportDriverContext,
): { text: string; escalate: boolean } {
  const name = ctx.driverName || "Driver";
  const menu = TRANSPORT_BOT_PROMPTS.map(
    (q) => `• *${q.waKeyword}* — ${q.label}`,
  ).join("\n");

  switch (intent) {
    case "route":
      return {
        escalate: false,
        text: [
          `*Your route* — ${name}`,
          "",
          `Vehicle: ${ctx.vehicleReg} · ${ctx.vehicleName}`,
          `Route: *${ctx.routeName}*`,
          "",
          "Reply *STUDENTS* for boarding count.",
        ].join("\n"),
      };
    case "students":
      return {
        escalate: false,
        text: [
          `*Boarding* — ${ctx.routeName}`,
          "",
          `${ctx.studentCount} active student(s) on this route.`,
          "",
          "For changes, contact transport desk. Reply *HUMAN*.",
        ].join("\n"),
      };
    case "breakdown":
      return {
        escalate: true,
        text: [
          `*Breakdown / delay* — ${name}`,
          "",
          "Please share location + brief issue in your next message.",
          `Transport desk (${TENANT.shortName}) will call back.`,
        ].join("\n"),
      };
    case "human":
      return {
        escalate: true,
        text: `*Transport desk* — noted for ${name} (${ctx.vehicleReg}). Office will call shortly.`,
      };
    case "menu":
      return {
        escalate: false,
        text: [`*Transport driver* — ${name}`, "", menu].join("\n"),
      };
    default:
      return {
        escalate: false,
        text: [
          `*Transport* — ${name} · ${ctx.vehicleReg}`,
          "",
          menu,
        ].join("\n"),
      };
  }
}

/**
 * LLM fallback for driver messages the keyword matcher doesn't recognize —
 * grounded ONLY in this driver's own route/vehicle data. Drivers may be on
 * the road acting on this, so it must never guess at operational details
 * (other routes, schedules, school policy) it wasn't given, and it must
 * never handle anything that sounds like an emergency — that stays on the
 * existing BREAKDOWN/HUMAN escalation path. Returns null on any failure.
 */
async function tryTransportAiFallback(
  text: string,
  ctx: TransportDriverContext,
): Promise<string | null> {
  const system = `You are a WhatsApp assistant for a school bus driver at ${TENANT.nameDisplay}.
You may ONLY discuss the driver's own route/vehicle data given below (route name, vehicle, student count) and the existing commands (ROUTE, STUDENTS, BREAKDOWN, HUMAN).
You do NOT know other routes, schedules, traffic conditions, or transport policy — never guess at them.
If this sounds like an emergency, breakdown, or accident, tell them to reply *BREAKDOWN* immediately instead of answering.
For anything else outside the data given, tell them to reply *HUMAN* to talk to the transport desk.
Keep the reply under 300 characters, plain text (no markdown headers).`;

  const userMessage = `Driver: ${ctx.driverName} · Vehicle: ${ctx.vehicleReg} (${ctx.vehicleName}) · Route: ${ctx.routeName} · Students on route: ${ctx.studentCount}
Message: "${text}"`;

  try {
    const r = await generateTutorText({ system, userMessage });
    if (!r.ok) return null;
    return r.text.trim() || null;
  } catch {
    return null;
  }
}

/** Same as replyTransportBotIntent, but tries an LLM fallback for genuinely
 * unrecognized free text instead of always showing the quick-command menu. */
export async function replyTransportBotIntentWithAi(
  intent: TransportBotQuickId | "unknown",
  text: string,
  ctx: TransportDriverContext,
): Promise<{ text: string; escalate: boolean }> {
  const base = replyTransportBotIntent(intent, ctx);
  const trimmed = text.trim();
  if (
    intent === "unknown" &&
    trimmed.length > 3 &&
    !/^(hi|hello|namaste|hey|start|menu|main)$/i.test(trimmed)
  ) {
    const aiReply = await tryTransportAiFallback(text, ctx);
    if (aiReply) return { text: aiReply, escalate: false };
  }
  return base;
}
