import assert from "node:assert/strict";
import { EMAIL_PURPOSES, buildMimeMessage, defaultEmailSettings, isEmailAddress, normalizeEmailSettings, senderFor, textToHtml } from "./email";

console.log("email.selftest.ts");
assert.equal(isEmailAddress("a@b.co"), true);
assert.equal(isEmailAddress("nope"), false);
const d = defaultEmailSettings("bhbinternational.school");

/*
  EVERY purpose must have a usable default on the school's own domain.
  Pinning the exact strings here was worse than useless: it pinned
  `admissions@` and `accounts@`, neither of which exists in the school's
  Workspace, so the test passed happily while both would have failed at send
  time with `unauthorized_client` — an error that reads like a delegation
  fault and is not one. What matters is that a purpose cannot ship with a
  blank or off-domain sender, and that a new purpose cannot be added without
  one.
*/
for (const p of EMAIL_PURPOSES) {
  const from = senderFor(d, p.id).address;
  assert.ok(isEmailAddress(from), `${p.id} has no valid default sender`);
  assert.ok(
    from.endsWith("@bhbinternational.school"),
    `${p.id} default sender is off-domain: ${from}`,
  );
  assert.ok(senderFor(d, p.id).name.trim().length > 0, `${p.id} has no display name`);
}
const n = normalizeEmailSettings({ senders: { admissions: { address: "Enquiry@BHBinternational.school", name: "Admissions desk" }, fees: { address: "not-an-email" } }, replyTo: "bad", footer: "x" }, "bhbinternational.school");
assert.equal(n.senders.admissions.address, "enquiry@bhbinternational.school");
assert.equal(
  n.senders.fees.address,
  d.senders.fees.address,
  "invalid address falls back to the default, whatever the default is",
);
assert.equal(n.replyTo, "");
assert.equal(n.enabled, true);

const { raw, mime } = buildMimeMessage({ from: { address: "admissions@bhbinternational.school", name: "Admissions — BHB" }, to: ["parent@example.com"], replyTo: "office@bhbinternational.school", subject: "नमस्ते Sharma ji — follow-up", text: "Hello\n\nLine 2", html: "<p>Hello</p>", attachments: [{ filename: "offer.pdf", contentType: "application/pdf", contentBase64: "JVBERi0=" }] });
assert.match(mime, /^From: =\?UTF-8\?B\?.*\?= <admissions@bhbinternational.school>/m, "non-ASCII display name is RFC 2047 encoded");
assert.match(mime, /^Subject: =\?UTF-8\?B\?/m);
assert.match(mime, /^Reply-To: office@bhbinternational.school/m);
assert.match(mime, /multipart\/mixed/);
assert.match(mime, /multipart\/alternative/);
assert.match(mime, /Content-Disposition: attachment; filename="offer.pdf"/);
assert.ok(!/[+/=]/.test(raw), "raw is base64url");
const plain = buildMimeMessage({ from: { address: "a@b.co", name: "Plain" }, to: ["x@y.z"], subject: "Hi", text: "only text" }).mime;
assert.match(plain, /^From: Plain <a@b.co>/m);
assert.ok(!/multipart/.test(plain));
assert.match(textToHtml("a < b\n\nsecond"), /<p>a &lt; b<\/p><p>second<\/p>/);
console.log("OK — email.selftest.ts");
