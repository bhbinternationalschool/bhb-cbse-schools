/**
 * A member of staff sets only their own signature, and only a real, small
 * image (lib/staffSignature).
 *
 * Run: npx tsx src/lib/staffSignature.selftest.ts
 */
import assert from "node:assert/strict";
import {
  SIGNATURE_MAX_BYTES,
  signatureActorRefusal,
  signatureFileRefusal,
  sniffSignatureImage,
} from "@/lib/staffSignature";

console.log("staffSignature.selftest.ts");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

assert.equal(sniffSignatureImage(PNG), "png");
assert.equal(sniffSignatureImage(JPG), "jpg");
assert.equal(sniffSignatureImage(WEBP), "webp");
assert.equal(sniffSignatureImage(GIF), null, "a GIF is not taken");
assert.equal(sniffSignatureImage(SVG), null, "an SVG (scriptable) is never taken, whatever it is called");
assert.equal(sniffSignatureImage(new Uint8Array()), null);

// Who may set it.
assert.equal(signatureActorRefusal({ persona: "staff", sessionStaffId: "stf_1" }), null, "own signature");
assert.equal(signatureActorRefusal({ persona: "staff", sessionStaffId: "stf_1", claimedStaffId: "stf_1" }), null, "naming yourself is fine");
assert.deepEqual(signatureActorRefusal({ persona: "staff", sessionStaffId: "stf_1", claimedStaffId: "stf_2" }), {
  status: 403,
  message: "You can only set your own signature",
});
assert.equal(signatureActorRefusal({ persona: "parent", sessionStaffId: "" })?.status, 403, "a parent cannot");
assert.equal(signatureActorRefusal({ persona: "staff", sessionStaffId: "" })?.status, 403, "a staff session with no record cannot");
assert.equal(signatureActorRefusal({ persona: "staff", sessionStaffId: "stf_1", claimedStaffId: "  " }), null, "a blank claim is no claim");

// The file.
assert.equal(signatureFileRefusal({ size: PNG.length, bytes: PNG }), null);
assert.equal(signatureFileRefusal({ size: 0, bytes: null })?.status, 400);
assert.equal(signatureFileRefusal({ size: SIGNATURE_MAX_BYTES + 1, bytes: PNG })?.status, 400, "over 1 MB");
assert.equal(signatureFileRefusal({ size: SIGNATURE_MAX_BYTES, bytes: PNG }), null, "exactly 1 MB is allowed");
assert.match(signatureFileRefusal({ size: SVG.length, bytes: SVG })!.message, /PNG, JPG or WebP/);

console.log("ok");
