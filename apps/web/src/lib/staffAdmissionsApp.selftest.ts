/**
 * Staff app admissions — the rules the phone's routes add on top of the
 * web desk's own functions.
 *
 *   - a registration fee and a payment are read strictly (whole rupees, no
 *     more than the fee, a reference for anything but cash);
 *   - the same child for the same family is never registered a second time;
 *   - "Registered" on the phone is the web's Registered + Verified;
 *   - the composer's preview is the template with this family's names.
 *
 * And end to end on the real functions: a desk registration with money
 * taken on the phone lands in the same RF- book with the right balance.
 */
import assert from "node:assert/strict";
import {
  createEnquiry,
  createRegistrationFromDesk,
  defaultAdmissionsState,
  registrationBalancePaise,
  takeRegistrationPayment,
  type AdmissionsState,
} from "@/lib/admissions";
import {
  isRegisteredStage,
  leadMessageDraft,
  parseRegistrationRequest,
  renderTemplatePreview,
  sameChildOnFile,
} from "@/lib/staffAdmissionsApp";

console.log("staffAdmissionsApp.selftest.ts");

const HEADS = ["fh_reg"];

// ── parseRegistrationRequest ──────────────────────────────────────────
{
  const ok = parseRegistrationRequest({ feeHeadId: "fh_reg", feeAmountRupees: 500 }, HEADS);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.feeAmountPaise, 50000);
    assert.equal(ok.value.collect, null, "no collect block = nothing received");
  }

  // A string from a phone keyboard is fine; a decimal or a negative is not.
  const s = parseRegistrationRequest({ feeHeadId: "fh_reg", feeAmountRupees: "750" }, HEADS);
  assert.ok(s.ok && s.value.feeAmountPaise === 75000);
  assert.equal(parseRegistrationRequest({ feeHeadId: "fh_reg", feeAmountRupees: "500.5" }, HEADS).ok, false);
  assert.equal(parseRegistrationRequest({ feeHeadId: "fh_reg", feeAmountRupees: -1 }, HEADS).ok, false);
  assert.equal(parseRegistrationRequest({ feeHeadId: "fh_reg", feeAmountRupees: "" }, HEADS).ok, false);

  // Fee head must be one the Registration desk offers.
  assert.equal(parseRegistrationRequest({ feeHeadId: "", feeAmountRupees: 500 }, HEADS).ok, false);
  assert.equal(parseRegistrationRequest({ feeHeadId: "fh_tuition", feeAmountRupees: 500 }, HEADS).ok, false);

  // Cash needs no reference; everything else does.
  const cash = parseRegistrationRequest(
    { feeHeadId: "fh_reg", feeAmountRupees: 500, collect: { amountRupees: 500, mode: "cash" } },
    HEADS,
  );
  assert.ok(cash.ok && cash.value.collect?.mode === "cash" && cash.value.collect.amountPaise === 50000);
  const upiNoRef = parseRegistrationRequest(
    { feeHeadId: "fh_reg", feeAmountRupees: 500, collect: { amountRupees: 500, mode: "upi", ref: " " } },
    HEADS,
  );
  assert.equal(upiNoRef.ok, false, "UPI without a UTR is refused");
  const upi = parseRegistrationRequest(
    { feeHeadId: "fh_reg", feeAmountRupees: 500, collect: { amountRupees: 200, mode: "upi", ref: "UTR123" } },
    HEADS,
  );
  assert.ok(upi.ok && upi.value.collect?.ref === "UTR123" && upi.value.collect.amountPaise === 20000);

  // Never more than the fee, never nothing, never a mode the phone doesn't offer.
  assert.equal(
    parseRegistrationRequest(
      { feeHeadId: "fh_reg", feeAmountRupees: 500, collect: { amountRupees: 501, mode: "cash" } },
      HEADS,
    ).ok,
    false,
  );
  assert.equal(
    parseRegistrationRequest(
      { feeHeadId: "fh_reg", feeAmountRupees: 500, collect: { amountRupees: 0, mode: "cash" } },
      HEADS,
    ).ok,
    false,
  );
  assert.equal(
    parseRegistrationRequest(
      { feeHeadId: "fh_reg", feeAmountRupees: 500, collect: { amountRupees: 100, mode: "barter", ref: "x" } },
      HEADS,
    ).ok,
    false,
  );
  // A zero fee cannot take money.
  assert.equal(
    parseRegistrationRequest(
      { feeHeadId: "fh_reg", feeAmountRupees: 0, collect: { amountRupees: 100, mode: "cash" } },
      HEADS,
    ).ok,
    false,
  );
}

// ── Registered stages ────────────────────────────────────────────────
assert.equal(isRegisteredStage("applied"), true);
assert.equal(isRegisteredStage("verified"), true);
assert.equal(isRegisteredStage("enquiry"), false);
assert.equal(isRegisteredStage("enrolled"), false, "admitted is not 'registered'");
assert.equal(isRegisteredStage("lost"), false);

// ── Template preview ─────────────────────────────────────────────────
assert.equal(
  renderTemplatePreview("Namaste {{guardianName}} ji — {{childName}} at *{{schoolName}}*", {
    guardianName: "Ram",
    childName: "Sita",
    schoolName: "BHB",
  }),
  "Namaste Ram ji — Sita at *BHB*",
);
assert.equal(
  renderTemplatePreview("Hi {{guardianName}}, {{ unknownVar }}", { guardianName: "  " }),
  "Hi —, —",
  "a value the school lacks shows as the same dash the send uses",
);

// ── Draft text ───────────────────────────────────────────────────────
{
  const d = leadMessageDraft({
    guardianName: "Ram",
    childName: "Sita",
    classSought: "LKG",
    schoolName: "BHB International School",
    registered: false,
  });
  assert.match(d, /Ram ji/);
  assert.match(d, /Sita's admission enquiry for Class LKG/);
  assert.doesNotMatch(d, /%20|%2C/, "plain words, not URL-encoded");
  const r = leadMessageDraft({
    guardianName: "",
    childName: "Sita",
    classSought: "",
    schoolName: "BHB",
    registered: true,
  });
  assert.match(r, /Parent ji/);
  assert.match(r, /registration is done/);
}

// ── Same child on file / end to end on the desk functions ────────────
{
  let state: AdmissionsState = defaultAdmissionsState();
  state = { ...state, leads: [], households: [] };
  const created = createEnquiry(
    state,
    { childName: "Sita Devi", guardianName: "Ram", mobile: "9811122233", classSoughtId: "c_lkg", source: "walk_in" },
    "Tester",
  );
  assert.ok(created.ok);
  if (!created.ok) throw new Error("unreachable");
  state = created.state;

  assert.equal(sameChildOnFile(state, "9811122233", "  sita   devi ")?.id, created.lead.id);
  assert.equal(sameChildOnFile(state, "9811122233", "Gita"), null, "a sibling is not a duplicate");
  assert.equal(sameChildOnFile(state, "9811122244", "Sita Devi"), null, "another family is not a duplicate");
  assert.equal(sameChildOnFile(state, "0000000000", "Sita Devi"), null, "a placeholder mobile is nobody");

  // New registration for a sibling, with part of the fee taken on the phone.
  const reg = createRegistrationFromDesk(
    state,
    {
      childName: "Gita",
      guardianName: "Ram",
      mobile: "9811122233",
      classSoughtId: "c_ukg",
      source: "walk_in",
      feeHeadId: "fh_reg",
      feeHeadName: "Registration fee",
      feeAmountPaise: 50000,
    },
    "Tester",
  );
  assert.ok(reg.ok);
  if (!reg.ok) throw new Error("unreachable");
  assert.equal(reg.lead.stage, "applied");
  assert.equal(reg.lead.householdId, created.lead.householdId, "sibling joins the family on file");
  assert.ok(reg.lead.applicationNo, "registration allocates an application number");

  const before = reg.state.nextRegPaySeq || 1;
  const paid = takeRegistrationPayment(reg.state, reg.lead.id, "Tester", {
    amountPaise: 20000,
    tenders: [{ mode: "upi", amountPaise: 20000, ref: "UTR123" }],
  });
  assert.ok(paid.ok);
  if (!paid.ok) throw new Error("unreachable");
  assert.match(paid.payment.code, /^RF-/, "same RF- book as the desk");
  assert.equal(paid.state.nextRegPaySeq, before + 1);
  const lead = paid.state.leads.find((l) => l.id === reg.lead.id)!;
  assert.equal(registrationBalancePaise(paid.state, lead), 30000);
  assert.equal(paid.payment.feeVoucherId, "", "no SIS student yet: the Fee Take receipt posts on admit");
}

console.log("OK — staffAdmissionsApp.selftest.ts");
