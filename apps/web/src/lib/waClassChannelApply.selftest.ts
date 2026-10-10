/**
 * The class-channel → ERP mapping.
 *
 * These rules decide what parents already received by WhatsApp looks like
 * in the school's own record, and they now run in two places — the browser
 * panel and the server-side applier that fires when a teacher confirms.
 * The point of these assertions is that the two cannot drift.
 *
 * Run: npx tsx src/lib/waClassChannelApply.selftest.ts
 */

import assert from "node:assert/strict";

import {
  classChannelBodyWithMedia,
  classChannelDraftIsApplicable,
  classChannelErpFields,
  type ClassChannelDraftLike,
} from "./waClassChannelApply";

function draft(over: Partial<ClassChannelDraftLike> = {}): ClassChannelDraftLike {
  return {
    id: "d1",
    channelId: "c1",
    kind: "homework",
    title: "Maths page 42",
    body: "Exercise 4.2, questions 1-10",
    subjectId: "sub_maths",
    subjectName: "Mathematics",
    dueAt: "",
    eventDate: "",
    mediaNote: "",
    status: "confirmed",
    createdByStaffId: "stf_1",
    createdByName: "Sunita Sharma",
    erpTarget: "homework",
    ...over,
  };
}

// ─── only a confirmed draft is filed ───────────────────────────────────
{
  assert.equal(classChannelDraftIsApplicable("confirmed"), true);
  // Already filed — the gate is what stops the browser fallback writing a
  // second copy of a post the server already wrote.
  assert.equal(classChannelDraftIsApplicable("applied"), true);
  assert.equal(classChannelDraftIsApplicable("pending"), false);
  assert.equal(classChannelDraftIsApplicable("cancelled"), false);
  assert.equal(classChannelDraftIsApplicable(""), false);
}

// ─── the media note ────────────────────────────────────────────────────
{
  assert.equal(classChannelBodyWithMedia("Do ex 4.2", ""), "Do ex 4.2", "no note, no brackets");
  assert.equal(
    classChannelBodyWithMedia("Do ex 4.2", "photo of the board"),
    "Do ex 4.2\n\n[photo of the board]",
  );
}

// ─── homework ──────────────────────────────────────────────────────────
{
  const f = classChannelErpFields(draft({ dueAt: "2026-09-08" }));
  assert.equal(f.target, "homework");
  if (f.target !== "homework") throw new Error("unreachable");
  assert.equal(f.title, "Maths page 42");
  assert.equal(f.body, "Exercise 4.2, questions 1-10", "the teacher's words reach parents unedited");
  assert.equal(f.subjectId, "sub_maths");
  assert.equal(f.dueAt, "2026-09-08");

  const noDue = classChannelErpFields(draft());
  assert.equal(noDue.target === "homework" && noDue.dueAt, "");

  const withPhoto = classChannelErpFields(draft({ mediaNote: "worksheet photo" }));
  assert.equal(
    withPhoto.target === "homework" && withPhoto.body,
    "Exercise 4.2, questions 1-10\n\n[worksheet photo]",
    "the ERP has no copy of the attachment, so it is described in the body",
  );
  // An event date belongs to a notice, not to homework, which has dueAt.
  const hwWithDate = classChannelErpFields(draft({ eventDate: "2026-09-10" }));
  assert.equal(hwWithDate.target === "homework" && hwWithDate.body, "Exercise 4.2, questions 1-10");
}

// ─── notices ───────────────────────────────────────────────────────────
{
  const notice = classChannelErpFields(
    draft({ erpTarget: "notice", kind: "notice", title: "Sports day", body: "Bring white shoes" }),
  );
  assert.equal(notice.target, "notice");
  if (notice.target !== "notice") throw new Error("unreachable");
  assert.equal(notice.audience, "parents", "a class channel speaks to that class's parents");
  assert.equal(notice.pinned, false);

  // A timing change concerns staff too — they have to be there for it.
  const timing = classChannelErpFields(draft({ erpTarget: "notice", kind: "timing" }));
  assert.equal(timing.target === "notice" && timing.audience, "all");
  assert.equal(timing.target === "notice" && timing.pinned, false);

  // Holidays and exams stay at the top until they have happened.
  for (const kind of ["holiday", "exam"]) {
    const f = classChannelErpFields(draft({ erpTarget: "notice", kind }));
    assert.equal(f.target === "notice" && f.pinned, true, `${kind} is pinned`);
    assert.equal(f.target === "notice" && f.audience, "parents", `${kind} is for parents`);
  }

  const dated = classChannelErpFields(
    draft({ erpTarget: "notice", kind: "holiday", body: "School closed", eventDate: "2026-09-10" }),
  );
  assert.equal(
    dated.target === "notice" && dated.body,
    "School closed\n\nDate: 2026-09-10",
    "the date a family needs is in the notice body, not only in the draft",
  );

  const datedWithPhoto = classChannelErpFields(
    draft({
      erpTarget: "notice",
      kind: "holiday",
      body: "School closed",
      eventDate: "2026-09-10",
      mediaNote: "circular photo",
    }),
  );
  assert.equal(
    datedWithPhoto.target === "notice" && datedWithPhoto.body,
    "School closed\n\nDate: 2026-09-10\n\n[circular photo]",
    "date first, then the attachment note",
  );
}

// ─── nothing to file ───────────────────────────────────────────────────
{
  // A question or a chat message has no ERP home; it must not become an
  // empty notice just because the teacher confirmed something.
  assert.deepEqual(classChannelErpFields(draft({ erpTarget: "none", kind: "help" })), {
    target: "none",
  });
}

console.log("waClassChannelApply.selftest.ts OK");
