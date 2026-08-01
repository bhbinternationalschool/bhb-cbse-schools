import { NextResponse } from "next/server";
import { ingestGoogleLead } from "@/lib/admissionsLeadIngest.server";
import {
  googleLeadWebhookConfigured,
  parseGoogleLeadFormPayload,
  verifyGoogleLeadWebhookKey,
  type GoogleLeadFormPayload,
  type ParsedGoogleLead,
  type SimpleLeadWebhookBody,
} from "@/lib/googleLeadForm.server";

export const runtime = "nodejs";

function webhookUrl(req: Request): string {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  ).replace(/\/$/, "");
  return `${base}/api/admissions/google-lead`;
}

/** Setup + health (no secret in response) */
export async function GET(req: Request) {
  return NextResponse.json({
    service: "google-lead-form",
    webhookUrl: webhookUrl(req),
    keyConfigured: googleLeadWebhookConfigured(),
    method: "POST",
    contentType: "application/json",
    setup: [
      "Google Ads → Assets → Lead form → Download leads → Webhook",
      "Paste webhook URL above",
      "Set the same key in GOOGLE_LEAD_WEBHOOK_KEY and in Google Ads webhook settings",
      "Map form fields: child name, parent/guardian, phone, class (custom questions)",
    ],
    testBody: {
      google_key: "(same as env)",
      lead_id: "test-001",
      childName: "Aarav Singh",
      guardianName: "Ramesh Singh",
      mobile: "9876543210",
      className: "V",
      locality: "Sigra",
    },
    googleNativeExample: {
      lead_id: "TeSter-123-abcdefgh",
      google_key: "(your key)",
      user_column_data: [
        { column_id: "FULL_NAME", column_name: "Full name", string_value: "Ramesh Singh" },
        { column_id: "PHONE_NUMBER", column_name: "Phone", string_value: "+919876543210" },
        { column_id: "CUSTOM_QUESTION", column_name: "Child name", string_value: "Aarav Singh" },
        { column_id: "CUSTOM_QUESTION", column_name: "Class sought", string_value: "Class V" },
      ],
      campaign_id: 1234567890,
      is_test: true,
    },
  });
}

export async function POST(req: Request) {
  const headerKey = req.headers.get("x-google-lead-key");

  let body: GoogleLeadFormPayload | SimpleLeadWebhookBody;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!verifyGoogleLeadWebhookKey(body, headerKey)) {
    return NextResponse.json({ error: "Invalid google_key" }, { status: 401 });
  }

  const parsed = parseGoogleLeadFormPayload(body);
  if ("error" in parsed && !("googleLeadId" in parsed)) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const lead = parsed as ParsedGoogleLead;
  if (!lead.mobile && !lead.guardianName) {
    return NextResponse.json(
      { error: "Could not parse phone or guardian from lead payload" },
      { status: 422 },
    );
  }

  const result = await ingestGoogleLead(lead);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    enquiryNo: result.enquiryNo,
    leadId: result.leadId,
    duplicate: result.duplicate,
    test: result.test,
  });
}
