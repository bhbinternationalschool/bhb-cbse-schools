import "server-only";

/**
 * A child's UIDAI certificate, filled from the ERP: name and address from
 * SIS, the principal as certifier from Masters, the school's address.
 * See aadhaarCertificate.ts for the form and what is left for a person.
 */

import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis } from "@/lib/sis";
import { loadMasters } from "@/lib/masters";
import { TENANT } from "@/lib/types";
import { splitSchoolAddress, type CertificateInput } from "@/lib/aadhaarCertificate";
import { renderAadhaarCertificatePdf } from "@/lib/aadhaarCertificatePdf";

/** The principal, when Masters names exactly one active one; "" otherwise (the office writes it). */
function principalName(masters: ReturnType<typeof loadMasters>): string {
  const designations = (masters as unknown as { designations?: { id: string; name: string }[] }).designations ?? [];
  const principalDesig = new Set(designations.filter((d) => /principal/i.test(d.name) && !/vice/i.test(d.name)).map((d) => d.id));
  const staff = ((masters as unknown as { staff?: { fullName: string; status: string; designationId: string | null }[] }).staff ?? [])
    .filter((s) => s.status === "active" && s.designationId && principalDesig.has(s.designationId));
  return staff.length === 1 ? staff[0]!.fullName : "";
}

export async function buildAadhaarCertificate(studentId: string, issueDateIso: string): Promise<
  | { ok: true; pdf: Buffer; fileName: string; studentName: string; overflow: { field: string; rest: string }[]; blank: string[] }
  | { ok: false; error: string }
> {
  await ensureSchoolMirrorHydrated();
  const sis = loadSis();
  const student = sis.students.find((s) => s.id === studentId);
  if (!student) return { ok: false, error: "Student not found" };
  const hh = student.householdId ? sis.households.find((h) => h.id === student.householdId) : undefined;
  const masters = loadMasters();
  const split = splitSchoolAddress(hh?.address || student.permanentAddress || "");
  const input: CertificateInput = {
    issueDateIso,
    childName: student.fullName,
    aadhaarNumber: (student.aadhaarNumber || "").replace(/\D/g, ""),
    address: {
      house: "",
      street: "",
      landmark: hh?.landmark || "",
      area: hh?.locality || split.area,
      village: split.village,
      postOffice: split.postOffice,
      district: hh?.city || TENANT.city,
      state: hh?.state || TENANT.state,
      pin: hh?.pincode || "",
    },
    certifier: {
      name: principalName(masters),
      designation: "PRINCIPAL",
      officeAddress: `${TENANT.nameDisplay} AYAR ${TENANT.city}`,
      contact: TENANT.officePhone || "",
    },
  };
  const r = renderAadhaarCertificatePdf(input);
  const safe = student.fullName.replace(/[^A-Za-z0-9 ]+/g, " ").trim().replace(/\s+/g, "-");
  return {
    ok: true,
    pdf: r.pdf,
    fileName: `Aadhaar-certificate-${safe}-${issueDateIso}.pdf`,
    studentName: student.fullName,
    overflow: r.overflow,
    blank: r.blank,
  };
}
