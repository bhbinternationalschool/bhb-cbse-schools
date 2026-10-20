/**
 * The staff "Scan" routes, driven through the real handler with the real
 * mobile-feature and permission gates and a MOCKED model — no AI call is
 * ever made here. Also: the gate check-in's field rules (buildGateEntry).
 * Run: npx tsx src/lib/staffScanRoute.selftest.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertPermission, type ApiAuthContext } from "./api/v1/auth";
import { assertMobileFeature } from "./api/v1/mobileAccess.server";
import { handleStaffScan, type StaffScanDeps, type StaffScanReader } from "./api/v1/staffScan.server";
import { buildGateEntry } from "./api/v1/staffVisitors.server";
import { emptyMastersShell } from "./masters";
import { defaultRbacState } from "./rbac";
import { createKeyedRateLimiter } from "./rateLimit";
import { STAFF_SCAN_MAX_BASE64 } from "./staffScanReading";
import { emptyVisitorState } from "./visitors";

console.log("staffScanRoute.selftest.ts");

const masters = emptyMastersShell();
const rbac = defaultRbacState();
const ctxFor = (roleCode: string, persona: "staff" | "parent" = "staff"): ApiAuthContext =>
  ({
    session: {
      persona,
      roleCode,
      fullName: `Test ${roleCode}`,
      staffId: `stf_${roleCode}`,
      tenantSlug: "bhb-international",
      academicYearCode: "2026-27",
    },
    masters,
    rbac,
    rbacKnown: true,
    authKind: "session",
  }) as unknown as ApiAuthContext;

/** What the model "says" for each kind — the parsers run on it for real. */
let modelText = "";
let modelCalls = 0;
let failWith: "" | "not-configured" | "budget" | "read-failed" = "";
const mockRead: StaffScanReader = async (opts) => {
  modelCalls++;
  if (failWith) return { ok: false, failure: failWith, error: "mock failure" };
  const parsed = opts.parse(modelText);
  if (!parsed) return { ok: false, failure: "read-failed", error: "not JSON" };
  assert.ok(!/\d{12}/.test(opts.audit(parsed)), "the audit text never holds a 12-digit number");
  return { ok: true, result: parsed, generationId: "gen_test" };
};

const visitorDeps = (who: ApiAuthContext, limiter = createKeyedRateLimiter({ windowMs: 60_000, max: 100 })): StaffScanDeps => ({
  auth: async () => who,
  authorize: (ctx) => {
    assertMobileFeature(ctx, "visitor_gate");
    assertPermission(ctx, "visitors", "create");
  },
  read: mockRead,
  limiter,
  today: () => "2026-10-20",
});

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://example.test/api/v1/staff/visitors/scan", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const PHOTO = Buffer.from("not really a jpeg").toString("base64");
const idBody = { kind: "visitor_id", imageBase64: PHOTO, mimeType: "image/jpeg" };

void (async () => {
  /* ── who may scan at the gate ───────────────────────────────────────── */
  modelText = JSON.stringify({ readable: true, confidence: "high", idType: "aadhaar", name: "Ramesh Kumar", idNumber: "234567890123", address: "Ahirauli" });

  for (const role of ["teacher", "driver", "accounts"]) {
    modelCalls = 0;
    const res = await handleStaffScan(req(idBody), ["visitor_id", "vehicle_plate"], visitorDeps(ctxFor(role)));
    assert.equal(res.status, 403, `${role} has no Visitor gate screen → 403`);
    assert.equal(modelCalls, 0, `${role}: refused BEFORE the paid model call`);
  }
  {
    modelCalls = 0;
    const res = await handleStaffScan(req(idBody), ["visitor_id"], visitorDeps(ctxFor("parent", "parent")));
    assert.equal(res.status, 403, "a parent session is refused");
    assert.equal(modelCalls, 0);
  }

  for (const role of ["office", "gate", "owner"]) {
    modelCalls = 0;
    const res = await handleStaffScan(req(idBody), ["visitor_id", "vehicle_plate"], visitorDeps(ctxFor(role)));
    assert.equal(res.status, 200, `${role} may scan at the gate`);
    assert.equal(modelCalls, 1);
    const out = (await res.json()) as { data: { kind: string; reading: Record<string, unknown>; generationId: string } };
    assert.equal(out.data.kind, "visitor_id");
    assert.equal(out.data.reading.idNumber, "XXXX XXXX 0123", "the phone only ever gets the masked Aadhaar");
    assert.ok(!JSON.stringify(out).includes("234567890123"), "the full Aadhaar never leaves the server");
    assert.equal(out.data.generationId, "gen_test");
  }

  /* ── bad bodies are refused before the model ────────────────────────── */
  {
    const office = ctxFor("office");
    modelCalls = 0;
    assert.equal((await handleStaffScan(req("{nope"), ["visitor_id"], visitorDeps(office))).status, 400, "bad JSON");
    assert.equal((await handleStaffScan(req({ ...idBody, kind: "fuel_bill" }), ["visitor_id", "vehicle_plate"], visitorDeps(office))).status, 400, "a bill is not read by the gate route");
    assert.equal((await handleStaffScan(req({ ...idBody, mimeType: "application/pdf" }), ["visitor_id"], visitorDeps(office))).status, 400, "not an image");
    assert.equal(
      (await handleStaffScan(req({ ...idBody, imageBase64: "A".repeat(STAFF_SCAN_MAX_BASE64 + 10) }), ["visitor_id"], visitorDeps(office))).status,
      413,
      "an oversize photo",
    );
    assert.equal(
      (await handleStaffScan(req(idBody, { "content-length": "99999999" }), ["visitor_id"], visitorDeps(office))).status,
      413,
      "a declared oversize body is refused before it is read",
    );
    assert.equal(modelCalls, 0, "none of those reached the model");
  }

  /* ── rate limit per staff member ────────────────────────────────────── */
  {
    const tight = createKeyedRateLimiter({ windowMs: 60_000, max: 2 });
    const office = ctxFor("office");
    assert.equal((await handleStaffScan(req(idBody), ["visitor_id"], visitorDeps(office, tight))).status, 200);
    assert.equal((await handleStaffScan(req(idBody), ["visitor_id"], visitorDeps(office, tight))).status, 200);
    modelCalls = 0;
    assert.equal((await handleStaffScan(req(idBody), ["visitor_id"], visitorDeps(office, tight))).status, 429, "third in the window");
    assert.equal(modelCalls, 0);
    assert.equal((await handleStaffScan(req(idBody), ["visitor_id"], visitorDeps(ctxFor("gate"), tight))).status, 200, "another guard has their own window");
  }

  /* ── model outcomes ─────────────────────────────────────────────────── */
  {
    const office = ctxFor("office");
    modelText = JSON.stringify({ readable: true, confidence: "low", plate: "UP32AB1234" });
    const low = await handleStaffScan(req({ ...idBody, kind: "vehicle_plate" }), ["visitor_id", "vehicle_plate"], visitorDeps(office));
    assert.equal(low.status, 200, "low confidence is a true answer about the photo …");
    const lowBody = (await low.json()) as { data: { reading: { readable: boolean; plate: string; note: string } } };
    assert.equal(lowBody.data.reading.readable, false);
    assert.equal(lowBody.data.reading.plate, "", "… with nothing filled in");
    assert.ok(lowBody.data.reading.note);

    modelText = "Sorry, I can't read that.";
    assert.equal((await handleStaffScan(req(idBody), ["visitor_id"], visitorDeps(office))).status, 502, "garbage from the model is a failed call, not an empty card");
    failWith = "not-configured";
    assert.equal((await handleStaffScan(req(idBody), ["visitor_id"], visitorDeps(office))).status, 503);
    failWith = "budget";
    assert.equal((await handleStaffScan(req(idBody), ["visitor_id"], visitorDeps(office))).status, 429);
    failWith = "";
  }

  /* ── the bill route: the log book's screen gate ─────────────────────── */
  {
    const billDeps = (who: ApiAuthContext): StaffScanDeps => ({
      ...visitorDeps(who),
      authorize: (ctx) => assertMobileFeature(ctx, "route_manifest"),
    });
    modelText = JSON.stringify({ readable: true, confidence: "high", amountRupees: 2841.6, quantity: 30, ratePerUnit: 94.72, date: "2026-10-19" });
    const body = { kind: "fuel_bill", vehicleId: "veh_1", date: "2026-10-20", imageBase64: PHOTO, mimeType: "image/jpeg" };
    modelCalls = 0;
    assert.equal((await handleStaffScan(req(body), ["fuel_bill"], billDeps(ctxFor("teacher")))).status, 403, "a teacher has no log book");
    assert.equal((await handleStaffScan(req(body), ["fuel_bill"], billDeps(ctxFor("gate")))).status, 403, "nor does the gate");
    assert.equal(modelCalls, 0);
    const ok = await handleStaffScan(req(body), ["fuel_bill"], billDeps(ctxFor("driver")));
    assert.equal(ok.status, 200, "a driver may read a bill");
    const got = (await ok.json()) as { data: { reading: { amountRupees: number; quantity: number } } };
    assert.equal(got.data.reading.amountRupees, 2841.6);

    // The real route adds the vehicle / date checks the fuel save uses.
    const src = readFileSync(join(__dirname, "../app/api/v1/staff/logbook/scan-bill/route.ts"), "utf8");
    for (const must of ['assertMobileFeature(ctx, "route_manifest")', "registerAccess(", "assertVehicle(", "assertEditableDate(", 'handleStaffScan(request, ["fuel_bill"]']) {
      assert.ok(src.includes(must), `scan-bill route calls ${must}`);
    }
    const gateSrc = readFileSync(join(__dirname, "../app/api/v1/staff/visitors/scan/route.ts"), "utf8");
    for (const must of ['assertMobileFeature(ctx, "visitor_gate")', 'assertPermission(ctx, "visitors", "create")', "readStaffScanImage"]) {
      assert.ok(gateSrc.includes(must), `visitor scan route calls ${must}`);
    }
    const checkin = readFileSync(join(__dirname, "../app/api/v1/staff/visitors/checkin/route.ts"), "utf8");
    assert.ok(checkin.includes('assertPermission(ctx, "visitors", "create")'), "check-in asserts the permission too");
  }

  /* ── gate check-in fields ───────────────────────────────────────────── */
  {
    const state = emptyVisitorState();
    const now = new Date("2026-10-20T04:00:00.000Z");
    const base = { visitorName: "Ramesh", mobile: "", purpose: "meeting" as const };
    const mk = (over: Record<string, unknown>) => buildGateEntry(state, { ...base, ...over } as never, "Guard", now, () => "visit_server01");

    const e = mk({});
    assert.ok(typeof e === "object", "no mobile is fine");
    if (typeof e === "object") {
      assert.equal(e.mobile, "");
      assert.equal(e.peopleCount, 1, "people default to 1");
      assert.equal(e.id, "visit_server01");
    }
    assert.equal(mk({ mobile: "12345" }), "Mobile number should be 10 digits");
    assert.match(mk({ mobile: "5123456789" }) as string, /starts with 6/);
    assert.match(mk({ peopleCount: 0 }) as string, /at least 1/);
    assert.match(mk({ peopleCount: "1.5" }) as string, /whole number/);
    assert.equal(mk({ visitorName: "  " }), "Visitor name required");

    const full = mk({
      mobile: "+91 98765 43210", peopleCount: "4", vehicleNo: "up 32 ab 1234",
      idProofNote: "Aadhaar 2345 6789 0123", address: "Ahirauli", clientId: "visit_phone123",
    });
    assert.ok(typeof full === "object");
    if (typeof full === "object") {
      assert.equal(full.mobile, "9876543210");
      assert.equal(full.peopleCount, 4);
      assert.equal(full.vehicleNo, "UP 32 AB 1234");
      assert.equal(full.idProofNote, "Aadhaar XXXX XXXX 0123", "a typed full Aadhaar is masked before it is stored");
      assert.equal(full.address, "Ahirauli");
      assert.equal(full.id, "visit_phone123", "the phone's id is kept so a retry finds this visit");
    }
    const forged = mk({ clientId: "../../etc" });
    assert.ok(typeof forged === "object" && forged.id === "visit_server01", "a malformed client id is ignored");
  }

  console.log("  ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
