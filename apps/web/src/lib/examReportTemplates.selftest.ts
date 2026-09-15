/**
 * Run: npx tsx src/lib/examReportTemplates.selftest.ts
 *
 * Pins the report card template rules (lib/examReportTemplates.ts):
 * - one fallback template always exists and reproduces the classic card;
 * - a class belongs to one template; the fallback catches the rest;
 * - presets prefill the switches they promise and stay editable;
 * - the printed presentation takes the template's switch when set and the
 *   scheme's otherwise (photo, attendance, rank, average, result).
 */
import assert from "node:assert/strict";

import {
  defaultReportCardTemplate,
  normalizeReportCardTemplates,
  reportCardTemplateForClass,
  resolvePresentation,
  TEMPLATE_PRESETS,
  templateFromPreset,
  templateSummary,
} from "./examReportTemplates";
import { defaultExamPolicy, normalizeExamPolicy, reportTemplateForClassId } from "./exams";

console.log("examReportTemplates.selftest.ts");

{
  const list = normalizeReportCardTemplates([]);
  assert.equal(list.length, 1);
  assert.ok(list[0]!.isDefault);
  assert.equal(list[0]!.layout, "classic");
  assert.equal(list[0]!.title, "Progress report");
  assert.deepEqual(list[0]!.signatureLabels, ["Class teacher", "Examination in-charge", "Principal"]);
}

{
  const hpc = templateFromPreset(TEMPLATE_PRESETS.find((p) => p.key === "hpc")!, ["cls_nur", "cls_lkg"]);
  const board = templateFromPreset(TEMPLATE_PRESETS.find((p) => p.key === "board_style")!, ["cls_lkg", "cls_x"]);
  const list = normalizeReportCardTemplates([hpc, board]);
  assert.equal(list.filter((t) => t.isDefault).length, 1, "a fallback is added when none is given");
  assert.equal(reportCardTemplateForClass("cls_nur", list).layout, "hpc");
  assert.equal(reportCardTemplateForClass("cls_lkg", list).layout, "hpc", "the first template keeps a class two claim");
  assert.equal(reportCardTemplateForClass("cls_x", list).title, "Statement of marks");
  assert.ok(reportCardTemplateForClass("cls_ix", list).isDefault, "an unnamed class gets the fallback");
  assert.equal(hpc.showPercent, false);
  assert.equal(hpc.showPhoto, true);
  assert.equal(board.showComponents, true);
  assert.equal(board.showResult, true);
  assert.ok(/holistic/i.test(templateSummary(hpc)));

  // Every field stays editable: a bad edit is normalised, not rejected.
  const edited = normalizeReportCardTemplates([{ ...board, signatureLabels: ["", "Principal", "  Parent "] }]);
  assert.deepEqual(edited.find((t) => t.id === board.id)?.signatureLabels, ["Principal", "Parent"]);
}

{
  const t = defaultReportCardTemplate();
  const fallback = { showPhoto: true, showAttendance: false, showRank: true, showClassAverage: false, showResult: true };
  const fromScheme = resolvePresentation(t, fallback);
  assert.equal(fromScheme.showPhoto, true, "tri-state unset → the scheme decides");
  assert.equal(fromScheme.showAttendance, false);
  assert.equal(fromScheme.showRank, true);
  const overridden = resolvePresentation({ ...t, showPhoto: false, showAttendance: true, showRank: false }, fallback);
  assert.equal(overridden.showPhoto, false, "the template's own switch wins when set");
  assert.equal(overridden.showAttendance, true);
  assert.equal(overridden.showRank, false);
  assert.equal(overridden.showResult, true, "…and the rest still come from the scheme");
}

{
  const policy = normalizeExamPolicy({ ...defaultExamPolicy(), reportTemplates: undefined as never });
  assert.equal(policy.reportTemplates.length, 1, "an old policy blob gets the classic template");
  assert.ok(reportTemplateForClassId("cls_any", policy).isDefault);
}

console.log("OK — examReportTemplates.selftest.ts");
