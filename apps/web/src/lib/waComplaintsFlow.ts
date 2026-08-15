/**
 * WhatsApp Flow — complaint/grievance intake.
 *
 * A single static, terminal screen (no data_channel_uri / server endpoint
 * needed — Meta just returns the filled form as a message on submit). Kept
 * static on purpose: a complaint form has no per-screen server logic or
 * conditional branching, so the encrypted data-exchange endpoint Meta
 * requires for dynamic flows would be pure added complexity here.
 */

import {
  COMPLAINT_CATEGORIES,
  type ComplaintCategory,
} from "@/lib/complaints";

export const COMPLAINT_FLOW_NAME = "bhb_complaint_intake";
export const COMPLAINT_FLOW_SCREEN_ID = "COMPLAINT_FORM";

export function buildComplaintFlowJson(): string {
  return JSON.stringify({
    version: "7.2",
    screens: [
      {
        id: COMPLAINT_FLOW_SCREEN_ID,
        title: "Raise a complaint",
        terminal: true,
        success: true,
        data: {},
        layout: {
          type: "SingleColumnLayout",
          children: [
            {
              type: "TextHeading",
              text: "Tell us what happened",
            },
            {
              type: "Dropdown",
              name: "category",
              label: "Category",
              required: true,
              "data-source": COMPLAINT_CATEGORIES.map((c) => ({
                id: c.value,
                title: c.label,
              })),
            },
            {
              type: "TextInput",
              name: "subject",
              label: "Subject",
              "input-type": "text",
              required: true,
            },
            {
              type: "TextArea",
              name: "description",
              label: "Details",
              required: true,
            },
            {
              type: "Footer",
              label: "Submit",
              "on-click-action": {
                name: "complete",
                payload: {
                  category: "${form.category}",
                  subject: "${form.subject}",
                  description: "${form.description}",
                },
              },
            },
          ],
        },
      },
    ],
  });
}

const CATEGORY_SET = new Set<ComplaintCategory>(
  COMPLAINT_CATEGORIES.map((c) => c.value),
);

/** Parse the `response_json` string Meta sends back on a completed
 * submission (nfm_reply). Defensive — a malformed/tampered payload must
 * not become a fabricated ticket, only a rejected one. */
export function parseComplaintFlowResponse(
  responseJson: string,
): { category: ComplaintCategory; subject: string; description: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  const subject = String(p.subject || "").trim();
  const description = String(p.description || "").trim();
  if (!subject || !description) return null;
  const category = CATEGORY_SET.has(p.category as ComplaintCategory)
    ? (p.category as ComplaintCategory)
    : "other";
  return { category, subject, description };
}

/** Flow-message send tokens encode the household so the webhook can
 * resolve who submitted without a live session — e.g. "cplt_hh_ab12cd". */
export function buildComplaintFlowToken(householdId: string): string {
  return `cplt_${householdId}`;
}

export function parseComplaintFlowToken(token: string): string | null {
  if (!token.startsWith("cplt_")) return null;
  const householdId = token.slice("cplt_".length);
  return householdId || null;
}
