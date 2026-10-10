/**
 * Google Ads Lead Form Extension — webhook payload parsing.
 * @see https://developers.google.com/google-ads/api/docs/lead-form-extensions
 */

export type GoogleLeadUserColumn = {
  column_id?: string;
  column_name?: string;
  string_value?: string;
};

export type GoogleLeadFormPayload = {
  lead_id?: string;
  user_column_data?: GoogleLeadUserColumn[];
  api_version?: string;
  form_id?: number | string;
  campaign_id?: number | string;
  adgroup_id?: number | string;
  creative_id?: number | string;
  gcl_id?: string;
  google_key?: string;
  is_test?: boolean;
};

export type ParsedGoogleLead = {
  googleLeadId: string;
  childName: string;
  guardianName: string;
  mobile: string;
  email: string;
  motherName: string;
  className: string;
  locality: string;
  pincode: string;
  note: string;
  campaignMeta: string;
  /** Google Ads campaign_id as a string — attribution key on the lead; "" when absent */
  campaignId: string;
  isTest: boolean;
};

/** Simple JSON body (Zapier / manual test) */
export type SimpleLeadWebhookBody = {
  childName?: string;
  guardianName?: string;
  mobile?: string;
  email?: string;
  motherName?: string;
  className?: string;
  locality?: string;
  pincode?: string;
  note?: string;
  google_key?: string;
  lead_id?: string;
};

export function googleLeadWebhookKey(): string {
  return (process.env.GOOGLE_LEAD_WEBHOOK_KEY || "").trim();
}

export function googleLeadWebhookConfigured(): boolean {
  return googleLeadWebhookKey().length > 0;
}

export function verifyGoogleLeadWebhookKey(
  payload: { google_key?: string },
  headerKey?: string | null,
): boolean {
  const expected = googleLeadWebhookKey();
  if (!expected) return true;
  const fromBody = (payload.google_key || "").trim();
  const fromHeader = (headerKey || "").trim();
  return fromBody === expected || fromHeader === expected;
}

function colHay(col: GoogleLeadUserColumn): string {
  return `${col.column_id || ""} ${col.column_name || ""}`.toLowerCase();
}

function pickColumn(
  cols: GoogleLeadUserColumn[],
  patterns: RegExp[],
): string {
  for (const col of cols) {
    const hay = colHay(col);
    if (patterns.some((p) => p.test(hay))) {
      return (col.string_value || "").trim();
    }
  }
  return "";
}

function splitFullName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0]!, last: "" };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

export function parseGoogleLeadFormPayload(
  raw: GoogleLeadFormPayload | SimpleLeadWebhookBody,
): ParsedGoogleLead | { error: string } {
  if (isSimpleLeadBody(raw)) {
    return parseSimpleLeadBody(raw);
  }

  const cols = raw.user_column_data || [];
  if (!cols.length) {
    return { error: "Empty user_column_data" };
  }

  const fullName = pickColumn(cols, [/full.?name/, /full_name/]);
  const firstName = pickColumn(cols, [/first.?name/, /first_name/]);
  const lastName = pickColumn(cols, [/last.?name/, /last_name/]);
  const guardianFromParts =
    [firstName, lastName].filter(Boolean).join(" ") || fullName;

  const childName =
    pickColumn(cols, [/child/, /student/, /ward/, /kid/]) ||
    pickColumn(cols, [/बच्च/, /छात्र/]) ||
    "";
  const guardianName =
    pickColumn(cols, [/guardian/, /parent/, /father/, /mother.*name/]) ||
    guardianFromParts;
  const motherName = pickColumn(cols, [/mother/, /माता/]);
  const mobile =
    pickColumn(cols, [/phone/, /mobile/, /whatsapp/, /contact/]) ||
    pickColumn(cols, [/PHONE_NUMBER/]);
  const email = pickColumn(cols, [/email/, /e-?mail/]);
  const className = pickColumn(cols, [
    /class/,
    /grade/,
    /standard/,
    /कक्षा/,
  ]);
  const locality = pickColumn(cols, [/city/, /locality/, /area/, /शहर/]);
  const pincode = pickColumn(cols, [/postal/, /pincode/, /pin.?code/, /zip/]);

  const customNotes = cols
    .filter((c) => /custom|question/i.test(colHay(c)))
    .map((c) => `${c.column_name || c.column_id}: ${c.string_value || ""}`)
    .filter((s) => s.length > 3)
    .join(" · ");

  const campaignParts = [
    raw.campaign_id != null ? `campaign ${raw.campaign_id}` : "",
    raw.adgroup_id != null ? `adgroup ${raw.adgroup_id}` : "",
    raw.form_id != null ? `form ${raw.form_id}` : "",
    raw.gcl_id ? `gclid ${raw.gcl_id}` : "",
  ].filter(Boolean);

  const resolvedChild =
    childName ||
    (guardianName && !fullName ? "" : "") ||
    "Child (Google lead)";
  const resolvedGuardian = guardianName || fullName || "Parent (Google lead)";

  return {
    googleLeadId: String(raw.lead_id || `gl_${Date.now()}`),
    childName: resolvedChild,
    guardianName: resolvedGuardian,
    mobile,
    email,
    motherName,
    className,
    locality,
    pincode,
    note: customNotes,
    campaignMeta: campaignParts.join(" · "),
    campaignId: raw.campaign_id != null ? String(raw.campaign_id).trim().slice(0, 80) : "",
    isTest: !!raw.is_test,
  };
}

function isSimpleLeadBody(
  raw: GoogleLeadFormPayload | SimpleLeadWebhookBody,
): raw is SimpleLeadWebhookBody {
  return (
    !("user_column_data" in raw) ||
    !Array.isArray((raw as GoogleLeadFormPayload).user_column_data)
  );
}

function parseSimpleLeadBody(body: SimpleLeadWebhookBody): ParsedGoogleLead {
  const full = (body.guardianName || "").trim();
  const split = splitFullName(full);
  return {
    googleLeadId: String(body.lead_id || `manual_${Date.now()}`),
    childName: (body.childName || "").trim() || "Child (lead form)",
    guardianName:
      (body.guardianName || "").trim() ||
      [split.first, split.last].filter(Boolean).join(" ") ||
      "Parent (lead form)",
    mobile: (body.mobile || "").trim(),
    email: (body.email || "").trim(),
    motherName: (body.motherName || "").trim(),
    className: (body.className || "").trim(),
    locality: (body.locality || "").trim(),
    pincode: (body.pincode || "").trim(),
    note: (body.note || "").trim(),
    campaignMeta: "manual / zapier",
    campaignId: String((body as { campaignId?: string }).campaignId || "").trim().slice(0, 80),
    isTest: false,
  };
}
