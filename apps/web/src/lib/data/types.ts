/**
 * The data-layer contract.
 *
 * Every incident on 2026-08-09/10 came from one of three shapes, and this
 * file exists to make each of them impossible to express rather than merely
 * unlikely:
 *
 *   1. A failed read that looked like empty data. `hydrateXFromDb` returned
 *      `{bundle: {}, ok: false}` — a success-shaped object with a flag
 *      nobody was obliged to check — so a caller that ignored `ok` rendered
 *      an empty screen and then pushed that emptiness back. Here the success
 *      and failure envelopes are structurally different types: there is no
 *      `rows` to read on a failure, so the compiler forces the check.
 *
 *   2. A locally-minted timestamp submitted as a server revision.
 *      `touchMastersDeskLocalMeta` stamped `new Date()` into the key the
 *      push sends as `baseUpdatedAt`, and masters became unsavable — 16
 *      refusals to 2 acceptances in one evening. `Revision` is branded, so
 *      `new Date().toISOString()` is not assignable to it. Only the server
 *      boundary may mint one, via `asRevision`.
 *
 *   3. A write whose outcome was discarded. Every push was `void pushX()`
 *      with failures going to `console.warn`, so the UI reported success
 *      regardless. `WriteResult` is a discriminated union that a caller must
 *      narrow before it can learn anything, and no function here returns
 *      `void`.
 */

/**
 * A revision is an instant the SERVER issued, never one a client made up.
 *
 * The brand is the whole point: it is not a `string` you can produce with
 * `Date.now()`. It enters the program only through `asRevision`, which lives
 * at the server boundary, so "the revision I hydrated at" cannot silently
 * become "the time I clicked save".
 */
export type Revision = string & { readonly __revision: unique symbol };

/**
 * Mint a Revision from a value that genuinely came from the database.
 *
 * Call this ONLY where a server response is being parsed. It is deliberately
 * not exported from the client barrel — if you find yourself reaching for it
 * in a component, the value you have is not a revision.
 */
export function asRevision(serverValue: string): Revision {
  return serverValue as Revision;
}

/** Opaque keyset cursor. Not an offset — offsets degrade at 100k rows. */
export type Cursor = string & { readonly __cursor: unique symbol };

// ─────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────

export type FailCode =
  | "network" // never reached the server
  | "auth" // 401/403 — session expired or not permitted
  | "unavailable" // 5xx, tenant not configured, DB down
  | "not_found" // unknown collection
  | "invalid"; // the request itself was malformed

/**
 * A failed read. Note what is absent: there is no `rows`, no `data`, no
 * empty array. A caller cannot accidentally render this as "no records" —
 * the property does not exist.
 */
export type ReadFail = {
  readonly ok: false;
  readonly code: FailCode;
  readonly error: string;
};

export type ReadOk<T> = {
  readonly ok: true;
  readonly rows: readonly T[];
  /** null when this is the last page. */
  readonly nextCursor: Cursor | null;
  /** The server's clock, for display only — never use it as a Revision. */
  readonly serverTime: string;
};

export type ReadResult<T> = ReadOk<T> | ReadFail;

export function isReadOk<T>(r: ReadResult<T>): r is ReadOk<T> {
  return r.ok;
}

// ─────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────

/**
 * One stated change.
 *
 * `base` is the revision the client believed it was editing. `null` means
 * "I have never seen this record" — allowed, and counted server-side as
 * `unversioned`, so clients deployed before the guard keep working during a
 * rollout. It is NOT a way to opt out of conflict detection.
 *
 * `row` is a Partial: the server patches rather than replaces, so a payload
 * carrying only the changed field cannot erase the rest of the record.
 */
export type WriteOp<T> =
  | {
      readonly op: "upsert";
      readonly id: string;
      readonly base: Revision | null;
      readonly row: Partial<T>;
    }
  | {
      readonly op: "delete";
      readonly id: string;
      readonly base: Revision | null;
    };

/** Per-record outcome. `conflict` carries the stored row so the UI can diff. */
export type RecordOutcome<T> =
  | {
      readonly id: string;
      readonly status: "applied" | "unchanged" | "deleted";
      readonly revision: Revision;
    }
  | {
      readonly id: string;
      readonly status: "conflict";
      readonly revision: Revision;
      readonly stored: T;
    };

export type WriteOk<T> = {
  readonly ok: true;
  readonly results: readonly RecordOutcome<T>[];
  /** Fresh revisions to re-stamp local records with. */
  readonly versions: Readonly<Record<string, Revision>>;
};

/**
 * A failed write. `kind` drives what the user is told, and the distinction
 * matters: reporting a server fault as "check your connection" is what sent
 * the director hunting a router that was working fine.
 */
export type WriteFail<T> = {
  readonly ok: false;
  readonly kind: FailCode | "conflict";
  readonly message: string;
  /** Populated when kind === "conflict"; empty otherwise. */
  readonly conflicts: readonly RecordOutcome<T>[];
};

export type WriteResult<T> = WriteOk<T> | WriteFail<T>;

export function isWriteOk<T>(r: WriteResult<T>): r is WriteOk<T> {
  return r.ok;
}

/**
 * Human-readable text for a failed write.
 *
 * Centralised so no call site invents its own wording, and so the network
 * case is the ONLY one that mentions the user's connection.
 */
export function describeWriteFailure<T>(fail: WriteFail<T>): string {
  switch (fail.kind) {
    case "conflict":
      return (
        "Not saved — someone else changed this while you were editing. " +
        "Reload to see their version, then re-apply your change."
      );
    case "network":
      return (
        "Not saved — could not reach the server. " +
        "Check your connection and try again."
      );
    case "auth":
      return (
        "Not saved — your session has expired or you do not have permission. " +
        "Sign in again and re-apply the change."
      );
    case "unavailable":
      return "Not saved — the server is unavailable. Please try again.";
    case "invalid":
    case "not_found":
      return `Not saved — ${fail.message}`;
  }
}
