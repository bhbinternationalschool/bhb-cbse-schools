/**
 * Self-test: the staff screens' saves as row writes (data-layer 2.2d) —
 * staffBookPlan.ts (pure) and commitStaffBook (with a fake server).
 */
import assert from "node:assert/strict";
import { normalizeStaffRecord, type StaffRecord } from "@/lib/foundationMasters";
import { planStaffBookCommit, storedStaffRecord, type StoredStaffBook } from "./staffBookPlan";

type Row = Record<string, unknown>;

console.log("staffBookPlan.selftest.ts");

const T0 = "2026-10-22T08:00:00.000Z";
const T1 = "2026-10-22T08:05:00.000Z";

function rec(id: string, p: Partial<StaffRecord> = {}): StaffRecord {
  return normalizeStaffRecord({ id, empCode: `E-${id}`, fullName: `Name ${id}`, mobile: "9000000001", ...p });
}
/** A stored sis_staff row for a record (what GET /api/data/sis.staff answers). */
function row(r: StaffRecord, at = T0): Row {
  const { loginPassword: _pw, ...profile } = r;
  return {
    id: r.id,
    emp_code: r.empCode,
    full_name: r.fullName,
    stream: r.stream,
    category: r.category,
    department_id: r.departmentId,
    designation_id: r.designationId,
    campus_id: r.campusId ?? "",
    mobile: r.mobile,
    email: r.email,
    status: r.status,
    profile,
    updated_at: at,
  };
}
const stored = (staff: StaffRecord[], extra: Partial<StoredStaffBook> = {}, at = T0): StoredStaffBook => ({
  staff: staff.map((s) => row(s, at)),
  departments: [],
  designations: [],
  ...extra,
});
type Plan = Extract<ReturnType<typeof planStaffBookCommit>, { ok: true }>;
const ok = (p: ReturnType<typeof planStaffBookCommit>): Plan => {
  assert.ok(p.ok, `expected a plan, got: ${p.ok ? "" : p.reason}`);
  return p as Plan;
};

const A = rec("a", { designationId: "des_tgt", fatherName: "Old father", bankAccountNo: "000111", loginUsername: "" });
const B = rec("b", { status: "inactive" });

/* 1. One field → one upsert of that field only, on the stored revision. */
{
  const p = ok(planStaffBookCommit({ shown: { staff: [A, B] }, next: { staff: [{ ...A, designationId: "des_pgt" }, B] }, stored: stored([A, B]) }));
  assert.equal(p.requests.length, 1);
  const [r] = p.requests;
  assert.equal(r!.collection, "sis.staff");
  assert.equal(r!.ops.length, 1, "only the edited member");
  const op = r!.ops[0] as { op: string; id: string; base: string; row: Row };
  assert.equal(op.op, "upsert");
  assert.equal(op.base, T0, "base = the stored revision");
  assert.deepEqual(op.row, { designation_id: "des_pgt", profile: { designationId: "des_pgt" } }, "only that field, column + profile");
  assert.equal(p.sensitive.length, 0);
  console.log("  ✓ one field → one row op of that field, on the stored revision");
}

/* 2. Another field changed elsewhere meanwhile: kept (not sent); the same field: a conflict, nothing sent. */
{
  const elsewhere = { ...A, fatherName: "Changed on the phone" };
  const p = ok(planStaffBookCommit({ shown: { staff: [A] }, next: { staff: [{ ...A, designationId: "des_pgt" }] }, stored: stored([elsewhere], {}, T1) }));
  const op = p.requests[0]!.ops[0] as { base: string; row: Row };
  assert.equal(op.base, T1);
  assert.ok(!("fatherName" in (op.row.profile as Row)), "a field this action did not touch is never sent");
  const c = planStaffBookCommit({ shown: { staff: [A] }, next: { staff: [{ ...A, fatherName: "Mine" }] }, stored: stored([elsewhere], {}, T1) });
  assert.ok(!c.ok && c.kind === "conflict", "the same field changed elsewhere first → conflict");
  assert.match(c.ok ? "" : c.reason, /Father's name/, "the conflict names the field");
  assert.deepEqual(c.ok ? null : c.conflicts, [{ id: "a", fields: ["fatherName"] }]);
  console.log("  ✓ other fields changed elsewhere are kept; the same field is a conflict, nothing sent");
}

/* 3. Protected fields go apart; the form's default username stays in the row write. */
{
  const next = { ...A, bankAccountNo: "999888", loginUsername: "e-a", fullName: "Renamed" };
  const p = ok(planStaffBookCommit({ shown: { staff: [A] }, next: { staff: [next] }, stored: stored([A]) }));
  const op = p.requests[0]!.ops[0] as { row: Row };
  const prof = op.row.profile as Row;
  assert.ok(!("bankAccountNo" in prof), "bank never in the row write");
  assert.equal(prof.loginUsername, "e-a", "blank → the default username: a row write");
  assert.equal(op.row.full_name, "Renamed");
  assert.deepEqual(p.sensitive, [{ id: "a", base: null, fields: { bankAccountNo: "999888" } }], "bank → the sensitive route, after the row write");
  const own = ok(planStaffBookCommit({ shown: { staff: [A] }, next: { staff: [{ ...A, loginUsername: "boss" }] }, stored: stored([A]) }));
  assert.equal(own.requests.length, 0, "only a login change: no row write");
  assert.deepEqual(own.sensitive, [{ id: "a", base: T0, fields: { loginUsername: "boss" } }], "a set username is the owner's route, on the stored revision");
  console.log("  ✓ bank / ID / pay / login → sensitive route; the default username stays in the row");
}

/* 4. Remove = a delete on the stored revision (the route makes it soft, with who); already gone = nothing. */
{
  const p = ok(planStaffBookCommit({ shown: { staff: [A, B] }, next: { staff: [A] }, stored: stored([A, B]) }));
  assert.deepEqual(p.requests[0]!.ops, [{ op: "delete", id: "b", base: T0 }]);
  const gone = ok(planStaffBookCommit({ shown: { staff: [A, B] }, next: { staff: [A] }, stored: stored([A]) }));
  assert.ok(gone.empty, "removed elsewhere already: nothing to send");
  console.log("  ✓ remove → one delete on the stored revision; already removed → nothing");
}

/* 5. Create: no base, every plain field, never the password; bank details apart. */
{
  const N = rec("n", { bankAccountNo: "123", loginPassword: "x", loginUsername: "" });
  const p = ok(planStaffBookCommit({ shown: { staff: [A] }, next: { staff: [A, N] }, stored: stored([A]) }));
  const op = p.requests[0]!.ops[0] as { op: string; base: unknown; row: Row };
  assert.equal(op.base, null);
  const prof = op.row.profile as Row;
  assert.equal(prof.fullName, "Name n");
  assert.equal(op.row.emp_code, "E-N");
  assert.ok(!("loginPassword" in prof), "never the password");
  assert.ok(!("bankAccountNo" in prof), "no bank details on create");
  assert.deepEqual(p.sensitive, [{ id: "n", base: null, fields: { bankAccountNo: "123" } }]);
  const dup = planStaffBookCommit({ shown: { staff: [] }, next: { staff: [A] }, stored: stored([A]) });
  assert.ok(!dup.ok && dup.kind === "conflict", "a new id the server already holds: refused");
  console.log("  ✓ create → no base, plain fields only, never a password; bank via the sensitive route");
}

/* 6. Links are merged link by link; documents document by document. */
{
  const L1 = { id: "l1", classId: "c1", sectionId: "s1", academicYearCode: "2026-27", isPrimary: true };
  const L2 = { id: "l2", classId: "c2", sectionId: "s2", academicYearCode: "2026-27", isPrimary: true };
  const L3 = { id: "l3", classId: "c3", sectionId: "s3", academicYearCode: "2026-27", isPrimary: true };
  const shown = { ...A, classTeacherLinks: [L1] };
  const storedNow = { ...A, classTeacherLinks: [L1, L2] }; // L2 added on another device
  const p = ok(planStaffBookCommit({ shown: { staff: [shown] }, next: { staff: [{ ...shown, classTeacherLinks: [L3] }] }, stored: stored([storedNow]) }));
  const links = ((p.requests[0]!.ops[0] as { row: Row }).row.profile as Row).classTeacherLinks as Row[];
  assert.deepEqual(links.map((l) => l.id), ["l2", "l3"], "L1 removed, L3 added, L2 (someone else's) kept");

  const doc = (fileUrl: string, status: "pending" | "verified" = "pending") => ({ status, fileName: "f", mimeType: "image/png", size: 1, fileUrl, uploadedAt: T0 });
  const D = { ...A, docs: { ...A.docs, photo: doc("/p1"), pan: doc("/pan1") } };
  const elsewhere = { ...D, docs: { ...D.docs, pan: doc("/pan2") } };
  const q = ok(
    planStaffBookCommit({
      shown: { staff: [D] },
      next: { staff: [{ ...D, docs: { ...D.docs, photo: doc("/p1", "verified") } }] },
      stored: stored([elsewhere]),
    }),
  );
  const docs = ((q.requests[0]!.ops[0] as { row: Row }).row.profile as Row).docs as Row;
  assert.equal((docs.photo as Row).status, "verified");
  assert.equal((docs.pan as Row).fileUrl, "/pan2", "a document changed elsewhere is kept");
  const clash = planStaffBookCommit({
    shown: { staff: [D] },
    next: { staff: [{ ...D, docs: { ...D.docs, pan: doc("/pan1", "verified") } }] },
    stored: stored([elsewhere]),
  });
  assert.ok(!clash.ok && clash.kind === "conflict", "the same document changed elsewhere → conflict");
  console.log("  ✓ links merged link by link; documents one by one (the same one → conflict)");
}

/* 7. Status, departments, designations; nothing changed = nothing sent. */
{
  const p = ok(planStaffBookCommit({ shown: { staff: [B] }, next: { staff: [{ ...B, status: "active" }] }, stored: stored([B]) }));
  assert.deepEqual((p.requests[0]!.ops[0] as { row: Row }).row, { status: "active", profile: { status: "active" } });
  const dep = { id: "dep_x", code: "SCI", name: "Science", isActive: true };
  const d = ok(planStaffBookCommit({ shown: { departments: [] }, next: { departments: [dep] }, stored: stored([]) }));
  assert.deepEqual(d.requests, [{ collection: "sis.departments", ops: [{ op: "upsert", id: "dep_x", base: null, row: { code: "SCI", name: "Science", is_active: true } }] }]);
  const des = { id: "des_x", code: "TGT", name: "TGT", departmentId: null, isActive: true };
  const desRow = { id: "des_x", code: "TGT", name: "Trained graduate", department_id: null, is_active: true, updated_at: T1 };
  const dc = planStaffBookCommit({ shown: { designations: [des] }, next: { designations: [{ ...des, name: "T.G.T." }] }, stored: stored([], { designations: [desRow] }) });
  assert.ok(!dc.ok && dc.kind === "conflict", "a designation renamed elsewhere → conflict");
  const same = ok(planStaffBookCommit({ shown: { staff: [A] }, next: { staff: [normalizeStaffRecord({ ...A })] }, stored: stored([A]) }));
  assert.ok(same.empty, "unchanged → nothing sent");
  assert.equal(storedStaffRecord(row(A)).designationId, "des_tgt");
  console.log("  ✓ status column + profile; departments / designations rows; unchanged → nothing");
}

/* 8. commitStaffBook: "saved" only after the server confirmed; a refusal comes back with the server's reason. */
void (async () => {
  const g = globalThis as Record<string, unknown>;
  const calls: { url: string; body?: unknown }[] = [];
  let answer: { status: number; body: unknown } = { status: 200, body: { ok: true, results: [{ id: "a", status: "applied", revision: T1 }], versions: { a: T1 } } };
  g.fetch = async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (!init?.method || init.method === "GET") {
      return { ok: true, status: 200, json: async () => ({ ok: true, rows: [row(A)], nextCursor: null }) };
    }
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body };
  };
  const { commitStaffBook } = await import("./staffBookWrites");
  const feeOnly = { staff: [A] };
  const unchanged = await commitStaffBook(feeOnly, feeOnly);
  assert.ok(unchanged.ok && unchanged.unchanged, "no staff list changed: nothing read or sent");
  assert.equal(calls.length, 0, "…not even a read");

  const saved = await commitStaffBook({ staff: [A] }, { staff: [{ ...A, designationId: "des_pgt" }] });
  assert.ok(saved.ok && !saved.unchanged);
  const posts = calls.filter((c) => c.body !== undefined);
  assert.deepEqual(posts.map((c) => c.url), ["/api/data/sis.staff"], "one kernel write; never masters-desk or staff-roster");

  answer = { status: 403, body: { ok: false, code: "auth", error: "Missing permission staff.edit" } };
  const refused = await commitStaffBook({ staff: [A] }, { staff: [{ ...A, designationId: "des_x" }] });
  assert.ok(!refused.ok);
  assert.equal(refused.ok ? "" : refused.kind, "auth");
  assert.match(refused.ok ? "" : refused.message, /^Not saved — Missing permission staff\.edit/, "the server's reason, said");
  console.log("  ✓ commitStaffBook: nothing sent for an unchanged roster; one kernel write; a refusal says the server's reason");
  console.log("\nAll staff book commit checks passed.");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
