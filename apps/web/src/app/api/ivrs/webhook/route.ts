import { NextResponse } from "next/server";
import { buildIvrResponse, ivrHealth } from "@/lib/ivrsFlow.server";

export const runtime = "nodejs";

function webhookUrl(req: Request): string {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  ).replace(/\/$/, "");
  return `${base}/api/ivrs/webhook`;
}

function parseBody(
  req: Request,
  raw: FormData | Record<string, string>,
): { callSid: string; from: string; digits: string } {
  const get = (k: string) => {
    if (raw instanceof FormData) return String(raw.get(k) || "");
    return String((raw as Record<string, string>)[k] || "");
  };
  return {
    callSid:
      get("CallSid") ||
      get("CallUUID") ||
      get("call_sid") ||
      `call_${Date.now()}`,
    from: get("From") || get("CallFrom") || get("from") || "",
    digits: get("Digits") || get("digits") || get("dtmf") || "",
  };
}

export async function GET(req: Request) {
  const secret = process.env.IVRS_WEBHOOK_SECRET?.trim();
  const key = req.headers.get("x-ivrs-secret")?.trim();
  if (secret && key !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ...ivrHealth(),
    webhookUrl: webhookUrl(req),
  });
}

/** Exotel / Twilio-style IVRS webhook — returns XML */
export async function POST(req: Request) {
  const secret = process.env.IVRS_WEBHOOK_SECRET?.trim();
  const key = req.headers.get("x-ivrs-secret")?.trim();
  if (secret && key !== secret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let parsed: { callSid: string; from: string; digits: string };
  const ctype = req.headers.get("content-type") || "";
  try {
    if (ctype.includes("application/json")) {
      const json = (await req.json()) as Record<string, string>;
      parsed = parseBody(req, json);
    } else {
      const form = await req.formData();
      parsed = parseBody(req, form);
    }
  } catch {
    parsed = { callSid: `call_${Date.now()}`, from: "", digits: "" };
  }

  const { xml } = buildIvrResponse({
    callSid: parsed.callSid,
    from: parsed.from,
    digits: parsed.digits,
    webhookUrl: webhookUrl(req),
  });

  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
