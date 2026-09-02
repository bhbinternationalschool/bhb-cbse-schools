/**
 * The publish gate. Two ways to get this wrong, both bad:
 * letting a publish through, and stopping an author saving a draft.
 */
import assert from "node:assert/strict";
import { batchNeedsApproval, rowNeedsApproval, type ApprovalRule } from "@/lib/data/approvalGate";
import { COLLECTIONS } from "@/lib/data/registry";

const RULE: ApprovalRule = {
  module: "website",
  whenEquals: { status: ["published", "scheduled"] },
  whenSet: ["published_at", "scheduled_publish_at"],
  message: "no",
};

function run() {
  // Ordinary work must stay ordinary.
  assert.equal(rowNeedsApproval(RULE, { title: "About us" }), false);
  assert.equal(rowNeedsApproval(RULE, { status: "draft" }), false, "an author must be able to save");
  assert.equal(rowNeedsApproval(RULE, { status: "archived" }), false, "taking a page down is not a decision");

  // Putting it in front of the public is.
  assert.equal(rowNeedsApproval(RULE, { status: "published" }), true);
  assert.equal(rowNeedsApproval(RULE, { status: "scheduled" }), true, "scheduling is publishing, later");
  assert.equal(rowNeedsApproval(RULE, { published_at: "2026-09-02T00:00:00Z" }), true);
  assert.equal(rowNeedsApproval(RULE, { scheduled_publish_at: "2026-10-01T00:00:00Z" }), true);

  // A column the write does not touch decides nothing.
  assert.equal(rowNeedsApproval(RULE, { status: undefined }), false);
  assert.equal(rowNeedsApproval(RULE, { published_at: null }), false, "clearing a date is unpublishing");
  assert.equal(rowNeedsApproval(RULE, { published_at: "" }), false, "so is blanking it");

  // A batch is atomic, so one publish hidden among drafts gates the whole
  // batch. Letting it through because most of it was innocent publishes the
  // page — this is the case the check exists for.
  assert.equal(
    batchNeedsApproval(RULE, [
      { op: "upsert", row: { title: "a" } },
      { op: "upsert", row: { status: "draft" } },
    ]),
    false,
  );
  assert.equal(
    batchNeedsApproval(RULE, [
      { op: "upsert", row: { title: "a" } },
      { op: "upsert", row: { status: "published" } },
    ]),
    true,
    "one publish in a batch of drafts still needs approval",
  );

  // No rule means no gate — every other collection is unaffected.
  assert.equal(batchNeedsApproval(undefined, [{ row: { status: "published" } }]), false);
  assert.equal(rowNeedsApproval(RULE, undefined), false);

  // The registry actually carries the rule, on the collection that needs it.
  const pages = COLLECTIONS.find((c) => c.id === "site.pages");
  assert.ok(pages, "site.pages must exist");
  assert.ok(pages!.approval, "publishing a page must be gated");
  assert.equal(pages!.approval!.module, "website");
  assert.ok(
    pages!.approval!.whenEquals?.status?.includes("published"),
    "the gate must fire on publishing",
  );
  assert.ok(
    pages!.approval!.whenEquals?.status?.includes("scheduled"),
    "a scheduled publish is still a publish",
  );

  console.log("approvalGate selftest: ok");
}

run();
