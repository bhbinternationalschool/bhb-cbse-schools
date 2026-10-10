/**
 * Who may see what the school is worth.
 *
 * The director's rule, 2026-09-20: the office — the accountant, the counter —
 * keys vouchers and runs the day sheet, but must not see the cash balance, the
 * bank balance, or income and expenditure for the session. Those are
 * management figures.
 *
 * `accounts` and `accounts_position` are therefore separate modules. This test
 * pins the split, because the accountant role holds `approve` on `accounts` —
 * so no existing action could have been reused as the gate, and a future edit
 * that "simplifies" them back together would silently reopen the counter's
 * view of the whole book.
 */
import assert from "node:assert/strict";
import {
  defaultRbacState,
  effectivePermissions,
  normalizeRbacState,
  type RbacRole,
} from "./rbac";

console.log("accountsPositionRbac.selftest.ts");

const state = defaultRbacState();
const role = (code: string): RbacRole => {
  const r = state.roles.find((x) => x.code === code);
  assert.ok(r, `role ${code} must exist`);
  return r!;
};
const can = (code: string, module: string, action: string): boolean =>
  !!effectivePermissions([role(code)]).get(module as never)?.has(action as never);

/* ─── management sees the position ────────────────────────── */
for (const code of ["owner", "principal", "admin"]) {
  assert.equal(can(code, "accounts_position", "view"), true, `${code} may see balances`);
}
// The CA reads the books at year end and changes nothing.
assert.equal(can("auditor", "accounts_position", "view"), true, "auditor may see balances");
assert.equal(can("auditor", "accounts", "edit"), false, "auditor still writes nothing");

/* ─── the office does not ─────────────────────────────────── */
for (const code of ["accounts", "office", "transport", "teacher"]) {
  assert.equal(
    can(code, "accounts_position", "view"),
    false,
    `${code} must NOT see cash/bank balances or session totals`,
  );
}

/* ─── but the accountant keeps the day job ────────────────── */
// If this fails the split has gone too far and the counter cannot work.
assert.equal(can("accounts", "accounts", "view"), true, "accountant still opens Accounts");
assert.equal(can("accounts", "accounts", "create"), true, "accountant still keys vouchers");
assert.equal(can("accounts", "accounts", "edit"), true);
assert.equal(can("accounts", "fees", "view"), true, "accountant still runs the counter");

/* ─── the gate could not have been an existing action ─────── */
// Why a new module was needed at all: every action on `accounts` that might
// have served as the gate is already held by the accountant.
for (const action of ["view", "create", "edit", "export", "approve"]) {
  assert.equal(
    can("accounts", "accounts", action),
    true,
    `accountant holds accounts:${action} — it cannot gate the position`,
  );
}

/* ─── a stored state from before the module existed ───────── */
// Built-in roles are merged forward on load. Without that, deploying this
// change would have taken the balances away from the owner too.
const stored = normalizeRbacState({
  roles: state.roles.map((r) => ({
    ...r,
    permissions: r.permissions.filter((p) => p.module !== "accounts_position"),
  })),
  assignments: [],
  audit: [],
});
const ownerAfter = stored.roles.find((r) => r.code === "owner");
assert.ok(ownerAfter, "owner survives normalize");
assert.equal(
  !!effectivePermissions([ownerAfter!]).get("accounts_position")?.has("view"),
  true,
  "a stored state predating the module still gives the owner the position",
);
const accountsAfter = stored.roles.find((r) => r.code === "accounts");
assert.equal(
  !!effectivePermissions([accountsAfter!]).get("accounts_position")?.has("view"),
  false,
  "and merging forward does not hand it to the office",
);

console.log("OK — accountsPositionRbac.selftest.ts");
