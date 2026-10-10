/**
 * Self-test: the parent document upload checks, on hand-built headers.
 * Run: npx tsx apps/web/src/lib/uploadValidation.selftest.ts
 */
import assert from "node:assert/strict";
import { checkDocumentUpload, imageDimensions, sniffKind } from "@/lib/uploadValidation";

function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
function jpg(w: number, h: number): Uint8Array {
  // SOI, an APP0 segment of length 16, then SOF0 with the size.
  const b = new Uint8Array(2 + 18 + 12);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 0);
  const sof = 2 + 18;
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], sof);
  new DataView(b.buffer).setUint16(sof + 5, h);
  new DataView(b.buffer).setUint16(sof + 7, w);
  return b;
}
const pdf = new TextEncoder().encode("%PDF-1.4\n%âãÏÓ\n");

assert.equal(sniffKind(png(1, 1)), "png");
assert.equal(sniffKind(jpg(1, 1)), "jpg");
assert.equal(sniffKind(pdf), "pdf");
assert.equal(sniffKind(new TextEncoder().encode("hello")), null);

assert.deepEqual(imageDimensions(png(1200, 800)), { width: 1200, height: 800 });
assert.deepEqual(imageDimensions(jpg(640, 480)), { width: 640, height: 480 });

// A good scan passes.
const good = checkDocumentUpload({ bytes: jpg(1600, 1200), declaredMime: "image/jpeg", docKey: "birthCert" });
assert.ok(good.ok && good.width === 1600);

// A renamed file is refused: bytes are PNG, name says PDF.
const renamed = checkDocumentUpload({ bytes: png(1600, 1200), declaredMime: "application/pdf", docKey: "birthCert" });
assert.ok(!renamed.ok && /contents are image\/png/.test(renamed.error));

// A thumbnail is refused for a document, but a smaller passport photo passes.
assert.ok(!checkDocumentUpload({ bytes: png(280, 900), declaredMime: "image/png", docKey: "aadhaar" }).ok);
assert.ok(checkDocumentUpload({ bytes: png(240, 300), declaredMime: "image/png", docKey: "photo" }).ok);

// A PDF passes as a document, never as the photo.
assert.ok(checkDocumentUpload({ bytes: pdf, declaredMime: "application/pdf", docKey: "tc" }).ok);
assert.ok(!checkDocumentUpload({ bytes: pdf, declaredMime: "application/pdf", docKey: "photo" }).ok);

// Empty and unknown bytes are refused with a reason a parent can act on.
assert.ok(!checkDocumentUpload({ bytes: new Uint8Array(0), declaredMime: "image/png", docKey: "tc" }).ok);
assert.ok(!checkDocumentUpload({ bytes: new TextEncoder().encode("not a file"), declaredMime: "", docKey: "tc" }).ok);

console.log("uploadValidation.selftest: ok");
