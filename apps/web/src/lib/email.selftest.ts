import assert from "node:assert/strict";
import { buildMimeMessage, defaultEmailSettings, isEmailAddress, normalizeEmailSettings, senderFor, textToHtml } from "./email";

console.log("email.selftest.ts");
assert.equal(isEmailAddress("a@b.co"), true);
assert.equal(isEmailAddress("nope"), false);
const d = defaultEmailSettings("bhbinternational.school");
assert.equal(senderFor(d, "admissions").address, "admissions@bhbinternational.school");
assert.equal(senderFor(d, "fees").address, "accounts@bhbinternational.school");
const n = normalizeEmailSettings({ senders: { admissions: { address: "Enquiry@BHBinternational.school", name: "Admissions desk" }, fees: { address: "not-an-email" } }, replyTo: "bad", footer: "x" }, "bhbinternational.school");
assert.equal(n.senders.admissions.address, "enquiry@bhbinternational.school");
assert.equal(n.senders.fees.address, "accounts@bhbinternational.school", "invalid address falls back to default");
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
