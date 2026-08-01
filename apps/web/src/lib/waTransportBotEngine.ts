/**
 * Fleet driver WhatsApp quick replies (route, students, breakdown).
 */

import { loadTransport } from "@/lib/transport";
import { TENANT } from "@/lib/types";

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
