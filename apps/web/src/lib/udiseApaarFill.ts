/**
 * The UDISE+ "Generate APAAR ID" page (Annexure-II, SDMS
 * #/school/<id>/apaarNewBasicDetails/<studentId>) from the ERP — and which
 * children the Office Robot may open it for.
 *
 * Director, 6 Oct 2026: "start with … APAAR". On that day the portal listed
 * 212 children, 101 with an APAAR ID, and 40 more whose Aadhaar UIDAI had
 * verified but who had none — while only 4 families had said yes on WhatsApp.
 *
 * The portal's own rules (its "Know about APAAR ID Generation" note): the
 * child needs a PEN, a saved General Profile and a VERIFIED Aadhaar; the head
 * of school gives consent on the guardian's behalf, so the school must hold a
 * physical copy of that consent (the ERP prints one at the WhatsApp tap —
 * lib/apaarConsentPdf); and the consenting parent's identity proof type and
 * number go on the page.
 *
 * The page's fields (read 6 Oct 2026, nothing submitted): consenterName,
 * consenterRelation (1 Father, 2 Mother, 3 Legal Guardian), idType
 * (1 AADHAAR, 2 PAN, 3 EPIC/Voter ID, 4 Driving Licence, 5 Passport), idNo,
 * place, hmName (prefilled by the portal). Native <select>s.
 *
 * Only a child the ERP calls ready (lib/udiseCompliance apaarReadiness:
 * consent given, the consenting parent's own Aadhaar on file, a PEN) is
 * offered, and only when the portal says its Aadhaar is verified. The robot
 * fills; a person checks the page and presses Submit. It never submits.
 */

import { samePersonName } from "@/lib/apaarConsent";
import type { SisStudent } from "@/lib/sis";

export type ApaarFillField = {
  control: string;
  kind: "text" | "select";
  value: string;
  label: string;
  shown: string;
};

export type ApaarFillPlan = {
  fields: ApaarFillField[];
  leftForYou: string[];
};

/** "<name> · WhatsApp +91… · msg …" → "<name>" (lib/apaarConsent records it so). */
export function consenterOf(s: Pick<SisStudent, "apaarConsentBy">): string {
  return String(s.apaarConsentBy || "").split(" · ")[0]!.trim();
}

function full12(v: string): string {
  const d = (v || "").replace(/\D/g, "");
  return /^[2-9]\d{11}$/.test(d) ? d : "";
}

export function buildApaarFillPlan(
  s: Pick<
    SisStudent,
    | "apaarConsentBy"
    | "fatherName"
    | "motherName"
    | "fatherAadhaarNumber"
    | "motherAadhaarNumber"
  >,
  place: string,
): ApaarFillPlan {
  const fields: ApaarFillField[] = [];
  const left: string[] = [];
  const who = consenterOf(s);
  const isFather = !!who && samePersonName(s.fatherName, who);
  const isMother = !isFather && !!who && samePersonName(s.motherName, who);

  if (who) {
    fields.push({ control: "consenterName", kind: "text", value: who.toUpperCase(), label: "Consent given by", shown: `${who} (WhatsApp)` });
  } else {
    left.push("Name of the parent / guardian giving consent");
  }
  if (isFather || isMother) {
    fields.push({ control: "consenterRelation", kind: "select", value: isFather ? "1" : "2", label: "Relation", shown: isFather ? "Father" : "Mother" });
  } else {
    // A grandparent or uncle who tapped "yes" is not on record as the
    // child's guardian; the person decides, the robot does not.
    left.push("Relation to the child");
  }
  const card = isFather ? full12(s.fatherAadhaarNumber) : isMother ? full12(s.motherAadhaarNumber) : "";
  if (card) {
    fields.push({ control: "idType", kind: "select", value: "1", label: "Identity proof", shown: "AADHAAR" });
    fields.push({ control: "idNo", kind: "text", value: card, label: "Identity proof number", shown: `Aadhaar ending ${card.slice(-4)}` });
  } else {
    left.push("Identity proof type and number of the consenting parent");
  }
  const p = (place || "").trim();
  if (p) fields.push({ control: "place", kind: "text", value: p, label: "Place", shown: p });
  else left.push("Place");
  left.push("Keep the printed consent record on the child's file (portal rule)");
  return { fields, leftForYou: left };
}

/** A child as the portal's current-year list gives it (the robot sends these). */
export type PortalApaarChild = {
  studentId: number | string;
  studentName: string;
  studentCodeNat: string;
  classId: number | string;
  sectionId?: number | string;
  uuidStatus?: number | string;
  apaarId?: string;
  apaarIdStatusDesc?: string;
};

export type ApaarQueueItem = {
  studentId: string;
  pen: string;
  name: string;
  classId: string;
  sectionId: string;
};

export type ApaarQueue = {
  /** ERP-ready and portal-verified, with no APAAR yet: the robot opens these. */
  items: ApaarQueueItem[];
  /** ERP-ready, but the portal has not verified the child's Aadhaar. */
  aadhaarNotVerified: { pen: string; name: string }[];
  /** Portal-verified with no APAAR, but the ERP is not ready (no consent / no parent card). */
  waitingInErp: number;
};

export function hasPortalApaar(c: PortalApaarChild): boolean {
  return String(c.apaarIdStatusDesc || "").toLowerCase() === "generated" || /\d{6,}/.test(String(c.apaarId || ""));
}

/**
 * `readyPens` — PENs the ERP calls ready (apaarReadiness). The portal list is
 * what the robot read a moment ago; a child counts only when both agree.
 */
export function buildApaarQueue(portal: PortalApaarChild[], readyPens: Set<string>): ApaarQueue {
  const items: ApaarQueueItem[] = [];
  const aadhaarNotVerified: { pen: string; name: string }[] = [];
  let waitingInErp = 0;
  for (const c of portal) {
    if (hasPortalApaar(c)) continue;
    const pen = String(c.studentCodeNat || "").replace(/\D/g, "");
    const verified = String(c.uuidStatus) === "1";
    const ready = !!pen && readyPens.has(pen);
    if (ready && verified) {
      items.push({
        studentId: String(c.studentId),
        pen,
        name: c.studentName,
        classId: String(c.classId),
        sectionId: String(c.sectionId ?? ""),
      });
    } else if (ready) {
      aadhaarNotVerified.push({ pen, name: c.studentName });
    } else if (verified) {
      waitingInErp++;
    }
  }
  return { items, aadhaarNotVerified, waitingInErp };
}
