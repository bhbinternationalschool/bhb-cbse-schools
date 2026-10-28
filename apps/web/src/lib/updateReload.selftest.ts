/**
 * Run: npx tsx src/lib/updateReload.selftest.ts
 *
 * data-layer 0.5g. A tab on an old build reloads itself on the next
 * client-side navigation — never on first render, never on a same-path
 * re-render, never with focus in a field, never with a save outstanding.
 * Drives the real rule the update bar uses (lib/updateReload).
 */
import assert from "node:assert/strict";
import { isEditableElement, shouldReloadForUpdate } from "./updateReload";

const base = { stale: true, previousPath: "/fees", path: "/students", editing: false, savesPending: false };

assert.equal(shouldReloadForUpdate(base), true, "stale + navigated + idle → reload");
assert.equal(shouldReloadForUpdate({ ...base, stale: false }), false, "current build → never");
assert.equal(shouldReloadForUpdate({ ...base, previousPath: null }), false, "first render → never");
assert.equal(shouldReloadForUpdate({ ...base, previousPath: "/students" }), false, "same path (query/hash change) → never");
assert.equal(shouldReloadForUpdate({ ...base, editing: true }), false, "focus in a field → wait for the next navigation");
assert.equal(shouldReloadForUpdate({ ...base, savesPending: true }), false, "a save not yet landed → wait");

assert.equal(isEditableElement({ tagName: "INPUT", type: "text" }), true);
assert.equal(isEditableElement({ tagName: "input" }), true, "an input with no type is text");
assert.equal(isEditableElement({ tagName: "INPUT", type: "number" }), true);
assert.equal(isEditableElement({ tagName: "TEXTAREA" }), true);
assert.equal(isEditableElement({ tagName: "SELECT" }), true);
assert.equal(isEditableElement({ tagName: "DIV", isContentEditable: true }), true);
assert.equal(isEditableElement({ tagName: "INPUT", type: "checkbox" }), false);
assert.equal(isEditableElement({ tagName: "BUTTON" }), false);
assert.equal(isEditableElement({ tagName: "A" }), false, "the link just clicked is not a field");
assert.equal(isEditableElement(null), false);

console.log("updateReload selftest: ok");
