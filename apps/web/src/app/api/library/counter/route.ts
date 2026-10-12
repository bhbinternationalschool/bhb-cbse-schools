/**
 * Library counter — look up a scanned copy, issue, return, add copies with
 * accession numbers, move a copy, and the loan/fine rules. Staff + the
 * `store` module (the library's RBAC home); every write is server-side.
 */

import { invBody, invQuery, invRoute } from "@/lib/inventory/route.server";
import { InvError } from "@/lib/inventory/db.server";
import { withLibraryDb } from "@/lib/libraryCounter.server";
import {
  addCopies,
  borrowerAccount,
  issueBooks,
  lookupForCounter,
  readLibraryRules,
  returnBooks,
  saveLibraryRules,
  updateCopy,
  type LibraryRules,
} from "@/lib/libraryCounter.server";
import { splitScannedCodes, type LibraryBorrowerRef } from "@/lib/libraryCounter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function borrowerOf(raw: unknown): LibraryBorrowerRef {
  const b = (raw ?? {}) as { type?: unknown; id?: unknown };
  const type = b.type === "staff" ? "staff" : b.type === "student" ? "student" : null;
  const id = typeof b.id === "string" ? b.id.trim() : "";
  if (!type || !id) throw new InvError("Choose a student or staff member");
  return { type, id };
}

function codesOf(raw: unknown): string[] {
  const text = Array.isArray(raw) ? raw.map(String).join("\n") : String(raw ?? "");
  const { codes, rejected } = splitScannedCodes(text);
  if (rejected.length) throw new InvError(`Not accession numbers: ${rejected.slice(0, 5).join(", ")}`);
  return codes;
}

export async function GET(req: Request) {
  return invRoute(req, "view", async () => withLibraryDb(async () => {
    const q = invQuery(req);
    const view = q.get("view") ?? "";
    if (view === "rules") return { rules: await readLibraryRules() };
    if (view === "lookup") return lookupForCounter(q.get("code") ?? "");
    if (view === "borrower") {
      return borrowerAccount(borrowerOf({ type: q.get("type"), id: q.get("id") }));
    }
    throw new InvError("Unknown view");
  }));
}

export async function POST(req: Request) {
  const body = await req
    .clone()
    .json()
    .catch(() => ({}) as Record<string, unknown>);
  const action = String((body as { action?: unknown }).action ?? "");
  // Issuing creates a loan; everything else edits the library.
  const rbac = action === "issue" || action === "add_copies" ? "create" : "edit";
  // Each job is its own sub-path for the library functions (Masters → Roles):
  // the counter issues and returns, Copies adds and moves copies, and the
  // loan rules stay with the Store grant (rbacFeatureCatalog/store.ts).
  const operation = /^[a-z_]+$/.test(action) ? `/api/library/counter/${action}` : undefined;
  return invRoute(req, rbac, async ({ actor, academicYearCode }) => withLibraryDb(async () => {
    const b = await invBody<Record<string, unknown>>(req);
    if (action === "issue") {
      return issueBooks({
        borrower: borrowerOf(b.borrower),
        codes: codesOf(b.codes),
        issuedOn: typeof b.issuedOn === "string" ? b.issuedOn : undefined,
        dueOn: typeof b.dueOn === "string" && b.dueOn ? b.dueOn : undefined,
        academicYearCode: String(b.academicYearCode || academicYearCode),
        issuedBy: actor,
        note: typeof b.note === "string" ? b.note.slice(0, 300) : "",
        issueCondition: typeof b.issueCondition === "string" ? b.issueCondition : "good",
        damageNote: typeof b.damageNote === "string" ? b.damageNote.slice(0, 300) : "",
      });
    }
    if (action === "return") {
      return returnBooks({
        codes: codesOf(b.codes),
        returnedOn: typeof b.returnedOn === "string" ? b.returnedOn : undefined,
        returnCondition: typeof b.returnCondition === "string" ? b.returnCondition : "good",
        damageNote: typeof b.damageNote === "string" ? b.damageNote.slice(0, 300) : "",
        returnedBy: actor,
      });
    }
    if (action === "add_copies") {
      return addCopies({
        titleId: String(b.titleId ?? ""),
        count: Number(b.count),
        location: typeof b.location === "string" ? b.location : "",
        source: typeof b.source === "string" ? b.source : "purchase",
        acquiredOn: typeof b.acquiredOn === "string" ? b.acquiredOn : undefined,
        procurementDocId: typeof b.procurementDocId === "string" ? b.procurementDocId : "",
      });
    }
    if (action === "update_copy") {
      return updateCopy({
        copyId: String(b.copyId ?? ""),
        location: typeof b.location === "string" ? b.location : undefined,
        status: typeof b.status === "string" ? b.status : undefined,
      });
    }
    if (action === "save_rules") {
      const r = (b.rules ?? {}) as Partial<Record<keyof LibraryRules, unknown>>;
      const pick: Partial<LibraryRules> = {};
      for (const k of ["maxBooksPerStudent", "maxBooksPerStaff", "loanDays", "finePaisePerDay", "graceDays", "capPaise"] as const) {
        if (r[k] !== undefined) pick[k] = Number(r[k]);
      }
      return { rules: await saveLibraryRules(pick) };
    }
    throw new InvError("Unknown action");
  }), { operation });
}
