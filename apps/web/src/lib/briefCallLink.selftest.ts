/**
 * The calling list's numbers must be dialable by tapping them.
 *
 * The 6 PM brief reaches the director and the principal on WhatsApp, on a
 * phone, and its last page is tomorrow's calling list. Reading a number off
 * a PDF and typing it into the dialler is the sort of friction that stops a
 * list being worked at all, so each number carries a real `tel:` link
 * annotation.
 *
 * Two things are checked, because either one alone would be a false comfort:
 * that a number becomes the right URI, and that jsPDF actually EMBEDS that
 * URI in the file it produces.
 *
 * Run: npx tsx src/lib/briefCallLink.selftest.ts
 */
import assert from "node:assert/strict";
import { jsPDF } from "jspdf";
import { telHrefForMobile } from "./udiseCompliance";

console.log("briefCallLink.selftest.ts");

/* ── The URI ── */
assert.equal(telHrefForMobile("9140132524"), "tel:+919140132524");
assert.equal(telHrefForMobile("91 9140 132524"), "tel:+919140132524", "spacing and country code are normalised");
assert.equal(telHrefForMobile("+91-9140-132524"), "tel:+919140132524");
/* Anything that is not a real Indian mobile yields NO link, so a half-entered
 * number never becomes a link that fails on tap. */
assert.equal(telHrefForMobile("no number"), "");
assert.equal(telHrefForMobile(""), "");
assert.equal(telHrefForMobile("12345"), "");
/* A country code or trunk 0 must not shift the number. normalizeMobile keeps
 * the FIRST ten digits, which turns 919140132524 into 9191401325 — a real
 * number belonging to somebody else. */
assert.equal(telHrefForMobile("919140132524"), "tel:+919140132524");
assert.equal(telHrefForMobile("09140132524"), "tel:+919140132524");
assert.equal(telHrefForMobile("914013252"), "", "too short even after stripping");
assert.equal(telHrefForMobile("0000000000"), "", "a placeholder row is not dialable");

/* ── The PDF really carries it ── */
const doc = new jsPDF({ unit: "pt", format: "a4" });
doc.setFontSize(9);
const href = telHrefForMobile("9140132524");
doc.text("9140132524", 40, 60);
doc.link(40, 52, 50, 11, { url: href });
const bytes = doc.output("arraybuffer");
const raw = Buffer.from(bytes).toString("latin1");
assert.ok(raw.includes("tel:+919140132524"), "the tel: URI must be embedded in the PDF, not merely drawn as text");
assert.ok(/\/Annots/.test(raw), "a link is an annotation — without one a phone has nothing to tap");
assert.ok(/\/URI/.test(raw), "the annotation must be a URI action");

/* A page with no link has no annotation, so the check above means something. */
const plain = new jsPDF({ unit: "pt", format: "a4" });
plain.text("9140132524", 40, 60);
assert.ok(!/\/URI/.test(Buffer.from(plain.output("arraybuffer")).toString("latin1")), "control: plain text carries no URI");

console.log("ok");
