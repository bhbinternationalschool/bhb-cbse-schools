/**
 * Fleet driver WhatsApp quick-reply catalogue — client-safe.
 *
 * Split out of waTransportBotEngine.ts (which imports aiLlm.server → next/headers)
 * so client code that only needs the menu (waChatbotFlows, waUnifiedMenus)
 * never drags the server-only LLM router into the browser bundle.
 */

export type TransportBotQuickId =
  | "route"
  | "students"
  | "breakdown"
  | "human"
  | "menu";

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
