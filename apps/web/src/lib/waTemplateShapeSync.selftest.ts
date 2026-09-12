/**
 * The registry must learn a template's SHAPE from Meta, not only its status.
 *
 * On 2026-09-12 the 6 PM brief had never once arrived. The seed declared a
 * DOCUMENT header for `bhb_daily_brief`; the submit path drops a media
 * header when it has no example file to send with it, so Meta created and
 * approved the template with a body and a footer and nothing else. The
 * registry went on believing the seed, the sender went on attaching a
 * document parameter, and Meta refused every send with "(#132018) There's
 * an issue with the parameters in your template". The scheduler log showed
 * a bare 502.
 *
 * The status sync had already been through this class of failure in
 * September. The shape had not.
 *
 * Run: npx tsx src/lib/waTemplateShapeSync.selftest.ts
 */
import assert from "node:assert/strict";
import { metaHeaderFormatOf } from "./waTemplates";

console.log("waTemplateShapeSync.selftest.ts");

/* Exactly what Meta returns for bhb_daily_brief — body and footer, no header. */
const dailyBrief = {
  name: "bhb_daily_brief",
  language: "en",
  status: "APPROVED",
  components: [
    { type: "BODY", text: "📊 *{{1}}* — {{2}}" },
    { type: "FOOTER", text: "Office · confidential" },
  ],
};
assert.equal(metaHeaderFormatOf(dailyBrief), "NONE", "no HEADER component means no header, whatever the seed says");

/* A template that really does carry a document header. */
assert.equal(
  metaHeaderFormatOf({
    name: "bhb_fee_receipt_pdf",
    language: "en",
    status: "APPROVED",
    components: [{ type: "HEADER", format: "DOCUMENT" }, { type: "BODY", text: "x" }],
  }),
  "DOCUMENT",
);
assert.equal(metaHeaderFormatOf({ name: "x", language: "en", status: "APPROVED", components: [{ type: "HEADER", format: "IMAGE" }] }), "IMAGE");
assert.equal(metaHeaderFormatOf({ name: "x", language: "en", status: "APPROVED", components: [{ type: "HEADER", format: "TEXT", text: "Fee reminder" }] }), "TEXT");
/* A HEADER with no format is a text header, which is Meta's own default. */
assert.equal(metaHeaderFormatOf({ name: "x", language: "en", status: "APPROVED", components: [{ type: "HEADER" }] }), "TEXT");
/* Lower case from the API must not change the answer. */
assert.equal(metaHeaderFormatOf({ name: "x", language: "en", status: "APPROVED", components: [{ type: "header", format: "document" }] }), "DOCUMENT");

/* THE IMPORTANT ONE: a list call that did not ask for components tells us
 * NOTHING, and must never be read as "this template has no header" — that
 * would strip the PDF from a template that really carries one. */
assert.equal(metaHeaderFormatOf({ name: "x", language: "en", status: "APPROVED" }), null, "silence is not an answer");
assert.equal(metaHeaderFormatOf({ name: "x", language: "en", status: "APPROVED", components: undefined }), null);

console.log("ok");
