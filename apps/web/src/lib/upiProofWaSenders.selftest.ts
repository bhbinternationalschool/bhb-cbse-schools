import assert from "node:assert/strict";
import { isUpiProofWaSender, upiProofWaMobiles } from "./upiProofWaSenders";

// Director, 15 Oct 2026: only the owner number records payments by WhatsApp.
delete process.env.UPI_PROOF_WA_MOBILES;
assert.deepEqual(upiProofWaMobiles(), ["9919101755"]);
assert.equal(isUpiProofWaSender("919919101755"), true, "owner number with country code (as WhatsApp sends it)");
assert.equal(isUpiProofWaSender("9919101755"), true);
assert.equal(isUpiProofWaSender("918736933297"), false, "any other staff number: no");
assert.equal(isUpiProofWaSender(""), false);

process.env.UPI_PROOF_WA_MOBILES = "+91 99191 01755, 9876543210";
assert.deepEqual(upiProofWaMobiles(), ["9919101755", "9876543210"], "override list, normalised");
assert.equal(isUpiProofWaSender("919876543210"), true);
delete process.env.UPI_PROOF_WA_MOBILES;

console.log("upiProofWaSenders selftest OK");
