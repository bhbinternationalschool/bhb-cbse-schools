/**
 * Server-side admission enquiry ingest (Google Lead Form, future webhooks).
 */

import {
  createEnquiry,
  findAdmissionLeadByMobile,
  logFollowUp,
  normalizeAdmissionsState,
  type AdmissionsState,
} from "@/lib/admissions";
import { fetchAdmissionsRemoteServer, pushAdmissionsRemoteServer } from "@/lib/admissionsPersistence";
import type { ParsedGoogleLead } from "@/lib/googleLeadForm.server";
import type { MastersState, SchoolClass } from "@/lib/masters";
import {
  ensureSchoolMirrorHydrated,
  writeSchoolMirror,
} from "@/lib/schoolDataMirror.server";

function resolveClassId(masters: MastersState | null, className: string): string {
  const raw = (className || "").trim();
  if (!raw || !masters?.classes?.length) return "";
  const low = raw.toLowerCase();
  const exact = masters.classes.find(
    (c: SchoolClass) => c.name.toLowerCase() === low || c.id === raw,
  );
  if (exact) return exact.id;
  const roman = masters.classes.find((c: SchoolClass) =>
    low.includes(c.name.toLowerCase()),
  );
  if (roman) return roman.id;
  const digit = low.match(/\b(\d{1,2})\b/);
  if (digit) {
    const byNum = masters.classes.find(
      (c: SchoolClass) => c.name === digit[1] || c.name === `Class ${digit[1]}`,
    );
    if (byNum) return byNum.id;
  }
  return "";
}

function leadAlreadyImported(
  state: AdmissionsState,
  googleLeadId: string,
): boolean {
  const token = `Google Lead · ${googleLeadId}`;
  return state.leads.some(
    (l) =>
      l.campaignNote?.includes(token) ||
      l.note?.includes(token) ||
      l.campaignNote?.includes(googleLeadId),
  );
}

async function loadAdmissionsForIngest(): Promise<AdmissionsState> {
  await ensureSchoolMirrorHydrated();
  const remote = await fetchAdmissionsRemoteServer();
  if (remote && remote.leads?.length) {
    return normalizeAdmissionsState(remote);
  }
  const mirror = (await ensureSchoolMirrorHydrated()).admissions;
  if (mirror) {
    return normalizeAdmissionsState(mirror as Partial<AdmissionsState>);
  }
  return normalizeAdmissionsState(null);
}

export async function ingestGoogleLead(
  parsed: ParsedGoogleLead,
): Promise<
  | {
      ok: true;
      enquiryNo: string;
      leadId: string;
      duplicate: boolean;
      test: boolean;
    }
  | { ok: false; error: string }
> {
  const mirror = await ensureSchoolMirrorHydrated();
  const masters = (mirror.masters as MastersState | null) || null;
  let state = await loadAdmissionsForIngest();

  if (leadAlreadyImported(state, parsed.googleLeadId)) {
    const existing = state.leads.find((l) =>
      l.campaignNote?.includes(parsed.googleLeadId),
    );
    return {
      ok: true,
      enquiryNo: existing?.enquiryNo || "",
      leadId: existing?.id || "",
      duplicate: true,
      test: parsed.isTest,
    };
  }

  const classSoughtId = resolveClassId(masters, parsed.className);
  const campaignNote = [
    `Google Lead · ${parsed.googleLeadId}`,
    parsed.campaignMeta,
    parsed.isTest ? "(test)" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const note = [
    parsed.note,
    parsed.email ? `Email: ${parsed.email}` : "",
    parsed.pincode ? `PIN: ${parsed.pincode}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const r = createEnquiry(
    state,
    {
      source: "google",
      childName: parsed.childName,
      guardianName: parsed.guardianName,
      motherName: parsed.motherName,
      mobile: parsed.mobile,
      classSoughtId,
      locality: parsed.locality,
      pincode: parsed.pincode,
      email: parsed.email,
      note,
      campaignNote,
      leadDate: new Date().toISOString().slice(0, 10),
    },
    "Google Lead Form",
    { allowMissingClass: true, publicSubmit: true },
  );

  if (!r.ok) {
    return { ok: false, error: r.reason };
  }

  state = r.state;
  const pushed = await pushAdmissionsRemoteServer(state);
  if (!pushed.ok) {
    return { ok: false, error: pushed.error || "Could not save lead to cloud" };
  }
  await writeSchoolMirror({ admissions: state });

  return {
    ok: true,
    enquiryNo: r.lead.enquiryNo,
    leadId: r.lead.id,
    duplicate: false,
    test: parsed.isTest,
  };
}

export type IngestWhatsAppLeadOpts = {
  mobile10: string;
  profileName?: string;
  waId?: string;
  /** First parent message text (stored on follow-up note). */
  inboundText?: string;
};

/**
 * Auto-create CRM enquiry when a new WhatsApp number messages admissions bot.
 */
export async function ingestWhatsAppAdmissionLead(
  opts: IngestWhatsAppLeadOpts,
): Promise<
  | {
      ok: true;
      created: boolean;
      enquiryNo: string;
      leadId: string;
      state: AdmissionsState;
    }
  | { ok: false; error: string }
> {
  const mobile10 = opts.mobile10.replace(/\D/g, "").slice(-10);
  if (mobile10.length !== 10) {
    return { ok: false, error: "Invalid mobile" };
  }

  let state = await loadAdmissionsForIngest();
  const existing = findAdmissionLeadByMobile(state, mobile10);
  if (existing) {
    return {
      ok: true,
      created: false,
      enquiryNo: existing.enquiryNo,
      leadId: existing.id,
      state,
    };
  }

  const profile = (opts.profileName || "").trim();
  const guardianName = profile.length >= 2 ? profile : "WhatsApp Parent";
  const childName = profile.length >= 2 ? `Child — ${profile}` : "Admission enquiry";
  const note = [
    "Auto-created from WhatsApp admissions bot.",
    opts.inboundText?.trim()
      ? `First message: ${opts.inboundText.trim().slice(0, 280)}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const r = createEnquiry(
    state,
    {
      source: "whatsapp",
      childName,
      guardianName,
      mobile: mobile10,
      whatsappSame: true,
      whatsapp: mobile10,
      whatsappDisplayName: profile,
      whatsappWaId: (opts.waId || "").replace(/\D/g, ""),
      note,
      campaignNote: `WhatsApp bot · ${new Date().toISOString().slice(0, 10)}`,
      leadDate: new Date().toISOString().slice(0, 10),
    },
    "WhatsApp admissions bot",
    { allowMissingClass: true, publicSubmit: true },
  );

  if (!r.ok) {
    return { ok: false, error: r.reason };
  }

  state = r.state;
  const logged = logFollowUp(
    state,
    r.lead.id,
    {
      channel: "whatsapp",
      outcome: "connected",
      note: opts.inboundText?.trim() || "First WhatsApp message to school number",
      nextFollowUpAt: "",
      assignToSelf: false,
    },
    "WhatsApp bot",
  );
  if (logged.ok) state = logged.state;

  const pushed = await pushAdmissionsRemoteServer(state);
  if (!pushed.ok) {
    return { ok: false, error: pushed.error || "Could not save lead to cloud" };
  }
  await writeSchoolMirror({ admissions: state });
  const { writeAdmissionsLocalRaw } = await import("@/lib/admissions");
  writeAdmissionsLocalRaw(state);

  return {
    ok: true,
    created: true,
    enquiryNo: r.lead.enquiryNo,
    leadId: r.lead.id,
    state,
  };
}
