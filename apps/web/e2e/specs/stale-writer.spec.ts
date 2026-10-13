/**
 * stale-writer — lands with step 1.5.
 *
 * COMMAND.md step 1.1: "a context pinned to the previous build's POST shape
 * (a whole-desk body from a pre-write copy) is refused and does not revert or
 * remove the row the kernel wrote". The refusal it checks (409 `unversioned`
 * for a null base on an existing row, version bumps on every applied op) is
 * built by step 1.5; until then there is no behaviour to assert, and this
 * spec does not invent one.
 */
import { test } from "../support";

test.fixme("a whole-desk POST from a pre-write copy is refused and does not revert the kernel's row (lands with step 1.5)", async () => {
  // Intentionally empty until step 1.5 — see the header.
});
