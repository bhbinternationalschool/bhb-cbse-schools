/**
 * The UDISE robot's to-do list: for every active child who is not yet
 * UDISE-complete, the NEXT thing that has to happen, and who does it.
 *
 * Two owners, because they are two different jobs:
 *  - `portal`  — the office, logged in to UDISE+ (add the child, enter or
 *    fix the Aadhaar, create the APAAR, accept a transfer);
 *  - `family`  — something only the parent can give (the child's Aadhaar,
 *    the APAAR answer, the consenting parent's own Aadhaar).
 *
 * Derived from SIS on every call and never stored, so a task leaves the list
 * the moment the fact that ends it lands (a portal export applied, a WhatsApp
 * document filed, a consent tap). "Done" is never a box someone ticks.
 *
 * Unknown must not become fact: an Aadhaar the portal has not reported on is
 * "enter and validate", not "failed"; a parent who has not answered about
 * APAAR is asked, never treated as a refusal (APAAR is voluntary — PEN is not).
 */

import { apaarReadiness, isUdiseFullyCompliant } from "@/lib/udiseCompliance";
import { hasStoredAadhaar, isRealPortalId, type SisStudent } from "@/lib/sis";

export type UdiseRobotTaskKind =
  | "accept_transfer"
  | "add_on_portal"
  | "fix_aadhaar_failed"
  | "validate_aadhaar"
  | "create_apaar"
  | "mbu_check"
  | "collect_child_aadhaar"
  | "ask_apaar_consent"
  | "collect_parent_aadhaar";

export type UdiseRobotOwner = "portal" | "family";

export type UdiseRobotTask = {
  kind: UdiseRobotTaskKind;
  owner: UdiseRobotOwner;
  /** One line for the office, naming what to check — never a guess at why. */
  note?: string;
};

export const UDISE_ROBOT_TASKS: Record<
  UdiseRobotTaskKind,
  { owner: UdiseRobotOwner; title: string; how: string; order: number }
> = {
  accept_transfer: {
    owner: "portal",
    order: 1,
    title: "Accept transfer on UDISE+",
    how: "Student module → Drop Box / Import: find the child by PEN and import. If the old school has not released the child, ask them to.",
  },
  add_on_portal: {
    owner: "portal",
    order: 2,
    title: "Add child on UDISE+ (gets the PEN)",
    how: "Student module → Add student with the SIS details. Aadhaar can be added later if the family has not given it yet.",
  },
  fix_aadhaar_failed: {
    owner: "portal",
    order: 3,
    title: "Aadhaar failed on the portal — fix and re-validate",
    how: "Compare the portal's name, date of birth and gender with the Aadhaar card on file, correct the portal, then validate again.",
  },
  validate_aadhaar: {
    owner: "portal",
    order: 4,
    title: "Enter Aadhaar on UDISE+ and validate",
    how: "The card is in the ERP. Enter the number on the child's portal profile and press validate.",
  },
  create_apaar: {
    owner: "portal",
    order: 5,
    title: "Create APAAR ID (parent said YES)",
    how: "APAAR module → the child → generate with the consenting parent's Aadhaar.",
  },
  mbu_check: {
    owner: "portal",
    order: 6,
    title: "Portal flags age / biometric update (MBU)",
    how: "Check the child's class against age on the portal; ask the family for an Aadhaar biometric update if the portal shows MBU pending.",
  },
  collect_child_aadhaar: {
    owner: "family",
    order: 7,
    title: "Collect the child's Aadhaar",
    how: "Families can send a photo on the school WhatsApp; the ERP reads and files it.",
  },
  ask_apaar_consent: {
    owner: "family",
    order: 8,
    title: "Ask the parent about APAAR (voluntary)",
    how: "Sent as two WhatsApp buttons with the weekly UDISE+ nudge. A NO is final and is fine.",
  },
  collect_parent_aadhaar: {
    owner: "family",
    order: 9,
    title: "Collect the consenting parent's Aadhaar",
    how: "APAAR is made on the Aadhaar of the parent who said YES.",
  },
};

function aadhaarFailed(s: SisStudent): boolean {
  return /fail/i.test(s.udiseAadhaarValidationStatus || "");
}

function aadhaarVerified(s: SisStudent): boolean {
  return (
    s.aadhaarVerification === "verified_udise" ||
    /^verified/i.test((s.udiseAadhaarValidationStatus || "").trim())
  );
}

/** Every open task for one child, most urgent first. [] when the child is done. */
export function udiseRobotTasksFor(s: SisStudent): UdiseRobotTask[] {
  if (isUdiseFullyCompliant(s)) return [];
  const tasks: UdiseRobotTask[] = [];
  const pen = isRealPortalId(s.pen);
  const apaar = isRealPortalId(s.apaarId);
  const childAadhaar = hasStoredAadhaar({ number: s.aadhaarNumber, last4: s.aadhaarLast4 });

  if (s.udiseInboundTransferPending) {
    tasks.push({ kind: "accept_transfer", owner: "portal" });
  } else if (!pen) {
    tasks.push({
      kind: "add_on_portal",
      owner: "portal",
      note: childAadhaar ? "Aadhaar is in the ERP — add it while creating." : "No Aadhaar yet — add the child without it.",
    });
  }

  if (childAadhaar && pen && !aadhaarVerified(s)) {
    if (aadhaarFailed(s)) {
      tasks.push({ kind: "fix_aadhaar_failed", owner: "portal", note: s.udiseAadhaarValidationStatus });
    } else {
      tasks.push({ kind: "validate_aadhaar", owner: "portal" });
    }
  }
  if (!childAadhaar) tasks.push({ kind: "collect_child_aadhaar", owner: "family" });

  // APAAR: only once a PEN exists does it become the school's next step.
  if (!apaar && s.apaarConsent !== "refused") {
    if (s.apaarConsent === "given") {
      const r = apaarReadiness(s);
      if (r.waitingFor.includes("parent_aadhaar")) {
        tasks.push({ kind: "collect_parent_aadhaar", owner: "family" });
      } else if (pen && childAadhaar) {
        tasks.push({
          kind: "create_apaar",
          owner: "portal",
          note: aadhaarVerified(s) ? undefined : "Validate the child's Aadhaar first.",
        });
      }
    } else {
      tasks.push({ kind: "ask_apaar_consent", owner: "family" });
    }
  }

  if (s.udiseAgeBelowClassAlert) tasks.push({ kind: "mbu_check", owner: "portal" });

  return tasks.sort((a, b) => UDISE_ROBOT_TASKS[a.kind].order - UDISE_ROBOT_TASKS[b.kind].order);
}

export type UdiseRobotChild = {
  student: SisStudent;
  tasks: UdiseRobotTask[];
};

export type UdiseRobotBoard = {
  total: number;
  done: number;
  open: number;
  /** Children per task kind, in the board's order. */
  byKind: { kind: UdiseRobotTaskKind; children: { student: SisStudent; note?: string }[] }[];
  portalTaskCount: number;
  familyTaskCount: number;
};

/**
 * The board, from one row per child (callers pass `studentsInSession(...)`
 * filtered to active — never the raw SIS list, which holds a row per year).
 */
export function buildUdiseRobotBoard(students: SisStudent[]): UdiseRobotBoard {
  const byKind = new Map<UdiseRobotTaskKind, { student: SisStudent; note?: string }[]>();
  let done = 0;
  let portalTaskCount = 0;
  let familyTaskCount = 0;
  for (const s of students) {
    const tasks = udiseRobotTasksFor(s);
    if (!tasks.length) {
      done += 1;
      continue;
    }
    for (const t of tasks) {
      if (t.owner === "portal") portalTaskCount += 1;
      else familyTaskCount += 1;
      const list = byKind.get(t.kind) ?? [];
      list.push({ student: s, note: t.note });
      byKind.set(t.kind, list);
    }
  }
  const kinds = (Object.keys(UDISE_ROBOT_TASKS) as UdiseRobotTaskKind[]).sort(
    (a, b) => UDISE_ROBOT_TASKS[a].order - UDISE_ROBOT_TASKS[b].order,
  );
  return {
    total: students.length,
    done,
    open: students.length - done,
    byKind: kinds
      .filter((k) => byKind.has(k))
      .map((k) => ({
        kind: k,
        children: byKind.get(k)!.sort((a, b) => a.student.fullName.localeCompare(b.student.fullName)),
      })),
    portalTaskCount,
    familyTaskCount,
  };
}

/** Which id/document a question is about ("class 3 without PEN"). */
export type UdiseQuestionFocus = "pen" | "apaar" | "aadhaar" | "failed" | "";

export function udiseQuestionFocus(text: string): UdiseQuestionFocus {
  const t = text.toLowerCase();
  if (/fail|reject|galat|invalid/.test(t)) return "failed";
  if (/\bpen\b/.test(t)) return "pen";
  if (/apaar|apar|\bapr\b/.test(t)) return "apaar";
  if (/aadha?ar|adhar|aadhar|आधार/.test(t)) return "aadhaar";
  return "";
}

/** Does this child match a "without X" focus? */
export function udiseMissing(s: SisStudent, focus: UdiseQuestionFocus): boolean {
  switch (focus) {
    case "pen":
      return !isRealPortalId(s.pen);
    case "apaar":
      return !isRealPortalId(s.apaarId) && s.apaarConsent !== "refused";
    case "aadhaar":
      return !hasStoredAadhaar({ number: s.aadhaarNumber, last4: s.aadhaarLast4 });
    case "failed":
      return aadhaarFailed(s) && !isUdiseFullyCompliant(s);
    default:
      return !isUdiseFullyCompliant(s);
  }
}

const FOCUS_LABEL: Record<Exclude<UdiseQuestionFocus, "">, string> = {
  pen: "without a PEN",
  apaar: "without an APAAR ID (declined APAAR not counted)",
  aadhaar: "with no Aadhaar on file",
  failed: "whose Aadhaar failed on the portal",
};

export type UdiseStatusLine = {
  fullName: string;
  classLabel: string;
  pen: string;
  apaarId: string;
  tasks: UdiseRobotTask[];
};

/** "Riya — VI A: PEN ✓ · APAAR ✗ — next: create APAAR ID". */
export function formatUdiseStudentReply(line: UdiseStatusLine & {
  aadhaarOnFile: boolean;
  aadhaarState: string;
  apaarConsent: string;
}): string {
  const out = [`*${line.fullName}* — ${line.classLabel}`];
  out.push(`PEN: ${isRealPortalId(line.pen) ? line.pen : "✗ none"}`);
  out.push(
    `APAAR: ${
      isRealPortalId(line.apaarId)
        ? line.apaarId
        : line.apaarConsent === "refused"
          ? "parent declined (settled)"
          : line.apaarConsent === "given"
            ? "✗ none — parent said YES"
            : "✗ none — parent not asked/answered"
    }`,
  );
  out.push(`Aadhaar: ${line.aadhaarOnFile ? line.aadhaarState || "on file" : "✗ not on file"}`);
  if (!line.tasks.length) {
    out.push("", "✅ UDISE complete — nothing to do.");
  } else {
    out.push("", "Next:");
    line.tasks.forEach((t, i) => {
      const def = UDISE_ROBOT_TASKS[t.kind];
      out.push(`${i + 1}. ${def.title}${t.owner === "family" ? " (family)" : ""}${t.note ? ` — ${t.note}` : ""}`);
    });
  }
  return out.join("\n");
}

/** School / class reply: counts, then the list when a focus or class narrows it. */
export function formatUdiseSummaryReply(input: {
  scopeLabel: string;
  focus: UdiseQuestionFocus;
  board: UdiseRobotBoard;
  matching: { fullName: string; classLabel: string }[];
  listLimit?: number;
}): string {
  const { board, focus } = input;
  const limit = input.listLimit ?? 40;
  const out: string[] = [];
  if (focus) {
    out.push(`*UDISE+ · ${input.scopeLabel}* — ${input.matching.length} ${FOCUS_LABEL[focus]}`);
    if (!input.matching.length) {
      out.push("None 🎉");
      return out.join("\n");
    }
  } else {
    out.push(`*UDISE+ · ${input.scopeLabel}* — ${board.done}/${board.total} complete, ${board.open} open`);
    if (board.open) {
      out.push("");
      for (const g of board.byKind) {
        const def = UDISE_ROBOT_TASKS[g.kind];
        out.push(`• ${def.title}${def.owner === "family" ? " (family)" : ""}: ${g.children.length}`);
      }
    }
    if (!input.matching.length) return out.join("\n");
    out.push("", "Open:");
  }
  input.matching.slice(0, limit).forEach((m, i) => out.push(`${i + 1}. ${m.fullName} — ${m.classLabel}`));
  if (input.matching.length > limit) out.push(`…and ${input.matching.length - limit} more (UDISE+ tab in the ERP).`);
  return out.join("\n");
}
