/**
 * "Is this child still ours?" — for any list of children on a UDISE+ page
 * (Student Release Requests from other schools, the Dropbox, the inactive
 * list). The robot reads the rows in the office's own tab; this decides,
 * from the ERP, whether each child is still studying here, has left, or is
 * unknown — so a release is approved only for a child who really left
 * (director, 7 Oct 2026: 3 release requests pending). Pure; never writes.
 */

import { isRealPortalId, type SisStudent } from "@/lib/sis";
import { udiseDobIso } from "@/lib/udiseStudentDetails";

export type PageChild = { pen?: string; name?: string; dob?: string };

export type CheckVerdict = {
  pen: string;
  name: string;
  verdict: "studying_here" | "left" | "not_in_erp" | "unsure";
  erpName: string;
  detail: string;
};

const up = (s: string) => (s || "").toUpperCase().replace(/[^A-Z\s]/g, " ").replace(/\s+/g, " ").trim();
const first = (s: string) => up(s).split(" ")[0] || "";

/** `currentAy`: the ERP session ("2026-27"); `className`: label for a row. */
export function checkPageChildren(
  rows: PageChild[],
  all: SisStudent[],
  currentAy: string,
  className: (s: SisStudent) => string,
): CheckVerdict[] {
  return rows.map((r) => {
    const pen = (r.pen || "").replace(/\D/g, "");
    const name = (r.name || "").trim();
    const dob = udiseDobIso(r.dob || "");
    let hits: SisStudent[] = [];
    let how = "";
    if (isRealPortalId(pen) && pen.length >= 8) {
      hits = all.filter((s) => (s.pen || "").replace(/\D/g, "") === pen);
      how = "same PEN";
    }
    if (!hits.length && name && dob) {
      hits = all.filter((s) => s.dob === dob && first(s.fullName) === first(name));
      how = "same first name + birth date";
    }
    if (!hits.length) {
      return { pen, name, verdict: "not_in_erp", erpName: "", detail: "No ERP child with this PEN (or this name + birth date)." };
    }
    const names = new Set(hits.map((h) => up(h.fullName)));
    if (names.size > 1 && how !== "same PEN") {
      return { pen, name, verdict: "unsure", erpName: [...names].join(" / "), detail: `More than one ERP child fits (${how}) — check by hand.` };
    }
    const latest = [...hits].sort((a, b) => (b.academicYearCode || "").localeCompare(a.academicYearCode || ""))[0]!;
    const here = hits.some((h) => h.academicYearCode === currentAy && h.status === "active");
    if (here) {
      const h = hits.find((x) => x.academicYearCode === currentAy && x.status === "active")!;
      return {
        pen,
        name,
        verdict: "studying_here",
        erpName: h.fullName,
        detail: `STILL STUDYING HERE per the ERP (${className(h)} ${currentAy}, ${how}). Do not release without checking with the family / office.`,
      };
    }
    return {
      pen,
      name,
      verdict: "left",
      erpName: latest.fullName,
      detail: `Left per the ERP — last in ${latest.academicYearCode || "an earlier year"} (${className(latest)}${latest.status === "inactive" ? ", marked inactive" : ""}; ${how}).`,
    };
  });
}
