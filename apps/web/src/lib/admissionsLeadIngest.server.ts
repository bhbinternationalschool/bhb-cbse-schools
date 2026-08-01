/**
 * Server-side admission enquiry ingest (Google Lead Form, future webhooks).
 */

import {
  createEnquiry,
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
