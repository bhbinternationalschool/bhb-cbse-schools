import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Stamped saves on the staff roster (10 Oct 2026). Every Masters save used
 * to POST the whole roster, which the server upserted with no version: a
 * stale tab editing a fee head put back old phone numbers, salaries and bank
 * details over edits made on another PC, the staff app or a UDISE+ sync.
 * Now only the staff rows this browser changed travel, each with the stamp
 * it loaded; a save that changed no staff sends nothing at all.
 */

console.log("staffRowStamps.selftest.ts");

const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.dispatchEvent ??= () => true;
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "anon";

const posts: { url: string; body: Record<string, unknown> }[] = [];
g.fetch = async (url: string, init?: { body?: string }) => {
  posts.push({ url, body: JSON.parse(init?.body || "{}") });
  return { ok: true, status: 200, json: async () => ({ ok: true, stamps: {}, conflicts: {} }) };
};

void (async () => {
  const { captureRowStamps } = await import("./rowStampClient");
  const { pushStaffSlice, STAFF_STAMPED_SLICES } = await import("./staffPersistence");

  const roster = {
    staff: [
      { id: "stf_1", empCode: "E1", fullName: "Asha", mobile: "9000000001" },
      { id: "stf_2", empCode: "E2", fullName: "Ravi", mobile: "9000000002" },
    ],
    departments: [{ id: "dep_1", code: "ACAD", name: "Academics" }],
    designations: [{ id: "des_1", code: "TGT", name: "TGT" }],
    feeHeads: [{ id: "fh_1", name: "Tuition" }],
  };
  captureRowStamps(
    "staff",
    {
      staff: { stf_1: "s1", stf_2: "s2" },
      departments: { dep_1: "d1" },
      designations: { des_1: "g1" },
    },
    roster,
    STAFF_STAMPED_SLICES,
  );

  // A Masters save that changed a fee head, not staff: no roster POST.
  await pushStaffSlice({ ...roster, feeHeads: [{ id: "fh_1", name: "Tuition fee" }] } as never);
  assert.equal(posts.length, 0, "a save with no staff change sends nothing");

  // One staff phone edited: only that record travels, with its loaded stamp.
  await pushStaffSlice({
    ...roster,
    staff: [roster.staff[0], { ...roster.staff[1], mobile: "9000000099" }],
  } as never);
  assert.equal(posts.length, 1);
  const sent = posts[0].body as { state: Record<string, { id: string }[]>; stamps: Record<string, Record<string, string>> };
  assert.deepEqual(sent.state.staff.map((s) => s.id), ["stf_2"], "only the edited record is sent");
  assert.deepEqual(sent.stamps.staff, { stf_2: "s2" }, "with the stamp it was loaded at");
  assert.equal(sent.state.feeHeads, undefined, "the rest of Masters does not ride along");
  console.log("  ok  only changed staff rows travel, with their stamps; no change → no POST");

  // ── Wiring ─────────────────────────────────────────────────────────────
  const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
  const persist = read("staffPersistence.ts");
  assert.ok(/writeStampedRows\(sb, table, tenantId, changed, named\)/.test(persist), "stamped rows written at their stamp");
  assert.ok(/ignoreDuplicates: true/.test(persist), "an unstamped save never replaces a stored row");
  assert.ok(!/sb\.from\("sis_staff"\)\.upsert\(slice, \{\s*onConflict: "id",\s*\}\)/.test(persist), "the old upsert-all is gone");
  assert.ok(/fetchAllPages/.test(persist), "the roster read is paged");
  assert.ok(/staff: stampsOfRows\(stfRes\.rows\)/.test(persist), "the load returns each row's stamp");
  const route = read("../app/api/school-data/staff-roster/route.ts");
  assert.ok(/readStampsParam\(body\.stamps, STAFF_STAMPED_SLICES\)/.test(route), "the route passes stamps through");
  const wa = read("waRoleResolver.server.ts");
  assert.ok(/altMobile: m10 \}, updated_at:/.test(wa), "a WhatsApp alt-mobile fix moves the record's stamp");
  console.log("  ok  wiring: stamped writer, insert-only legacy, paged read, server writers move stamps");

  console.log("\nAll staff row-stamp checks passed.");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
