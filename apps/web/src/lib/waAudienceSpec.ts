/**
 * WHO a manual WhatsApp send goes to, as a value rather than a list.
 *
 * Before this, each screen decided its own audience and handed the sender a
 * list of numbers: the dashboard modal knew "all parents" and "all staff",
 * a class teacher's button knew "my own section", admissions knew "leads".
 * Nothing could say "teaching staff only" or "these three classes", and
 * every new audience meant another route with its own idea of RBAC and its
 * own opt-out handling.
 *
 * The spec is sent to the server; the server resolves it. A client never
 * sends a list of mobiles — same reason the staff broadcast route verifies
 * `sectionId` against the teacher's real class links instead of trusting
 * it. A resolved list in a request body is an audience anybody can edit.
 *
 * Pure: the shape, its validation, and the words for a confirm dialog.
 */

export type StaffStreamFilter = "all" | "teaching" | "non_teaching";

export type WaAudienceSpec =
  /** Staff, optionally narrowed by stream, department or designation. */
  | {
      kind: "staff";
      stream?: StaffStreamFilter;
      departmentIds?: string[];
      designationIds?: string[];
    }
  /** Parents. No narrowing = every active family. */
  | {
      kind: "parents";
      /** Whole classes — every section under each. */
      classIds?: string[];
      /** Specific sections. Combined with classIds as a union. */
      sectionIds?: string[];
      /** Families who have not told us their language yet. */
      languageUnset?: boolean;
    }
  /** Families at a given fee recovery stage. */
  | { kind: "fee_stage"; stages: string[] }
  /** Hand-picked students, by SIS id. */
  | { kind: "students"; studentIds: string[] };

export type WaAudienceValidation =
  | { ok: true; spec: WaAudienceSpec }
  | { ok: false; error: string };

const STREAMS: StaffStreamFilter[] = ["all", "teaching", "non_teaching"];
const FEE_STAGES = ["S0", "S1", "S2", "S3", "S4"];

function ids(raw: unknown): string[] {
  return Array.isArray(raw)
    ? [...new Set(raw.map((x) => String(x || "").trim()).filter(Boolean))]
    : [];
}

/**
 * Read an audience off a request body.
 *
 * Rejects rather than guesses. An unparseable audience must never fall back
 * to a default, because every plausible default here is a whole-school send.
 */
export function parseWaAudienceSpec(raw: unknown): WaAudienceValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "No audience given" };
  }
  const a = raw as Record<string, unknown>;
  const kind = String(a.kind || "");

  if (kind === "staff") {
    const stream = String(a.stream || "all") as StaffStreamFilter;
    if (!STREAMS.includes(stream)) {
      return {
        ok: false,
        error: 'staff stream must be "all", "teaching" or "non_teaching"',
      };
    }
    return {
      ok: true,
      spec: {
        kind: "staff",
        stream,
        departmentIds: ids(a.departmentIds),
        designationIds: ids(a.designationIds),
      },
    };
  }

  if (kind === "parents") {
    return {
      ok: true,
      spec: {
        kind: "parents",
        classIds: ids(a.classIds),
        sectionIds: ids(a.sectionIds),
        languageUnset: !!a.languageUnset,
      },
    };
  }

  if (kind === "fee_stage") {
    const stages = ids(a.stages).map((s) => s.toUpperCase());
    const bad = stages.filter((s) => !FEE_STAGES.includes(s));
    if (bad.length) {
      return { ok: false, error: `Unknown fee stage: ${bad.join(", ")}` };
    }
    if (!stages.length) {
      return { ok: false, error: "Pick at least one fee stage" };
    }
    return { ok: true, spec: { kind: "fee_stage", stages } };
  }

  if (kind === "students") {
    const studentIds = ids(a.studentIds);
    if (!studentIds.length) {
      return { ok: false, error: "Pick at least one student" };
    }
    return { ok: true, spec: { kind: "students", studentIds } };
  }

  return {
    ok: false,
    error: 'audience kind must be "staff", "parents", "fee_stage" or "students"',
  };
}

/**
 * Does this spec mean EVERYBODY?
 *
 * Callers use it to demand a second confirmation. A whole-school send is the
 * expensive mistake on this screen — 199 families or every member of staff,
 * from one unnarrowed dropdown — so it is worth naming rather than treating
 * as just another audience.
 */
export function isWholeSchoolAudience(spec: WaAudienceSpec): boolean {
  if (spec.kind === "staff") {
    return (
      (spec.stream ?? "all") === "all" &&
      !spec.departmentIds?.length &&
      !spec.designationIds?.length
    );
  }
  if (spec.kind === "parents") {
    return (
      !spec.classIds?.length && !spec.sectionIds?.length && !spec.languageUnset
    );
  }
  return false;
}

/** One line for a confirm dialog. Never a bare "staff" or "parents". */
export function describeWaAudience(
  spec: WaAudienceSpec,
  names?: {
    classes?: Record<string, string>;
    sections?: Record<string, string>;
    departments?: Record<string, string>;
    designations?: Record<string, string>;
  },
): string {
  const list = (xs: string[], lookup?: Record<string, string>) =>
    xs.map((x) => lookup?.[x] || x).join(", ");

  if (spec.kind === "staff") {
    const who =
      spec.stream === "teaching"
        ? "Teaching staff"
        : spec.stream === "non_teaching"
          ? "Non-teaching staff"
          : "All staff";
    const parts: string[] = [];
    if (spec.departmentIds?.length) {
      parts.push(`in ${list(spec.departmentIds, names?.departments)}`);
    }
    if (spec.designationIds?.length) {
      parts.push(`designated ${list(spec.designationIds, names?.designations)}`);
    }
    return [who, ...parts].join(" ");
  }

  if (spec.kind === "parents") {
    if (spec.languageUnset) return "Parents who have not set a language";
    const parts: string[] = [];
    if (spec.classIds?.length) {
      parts.push(`Class ${list(spec.classIds, names?.classes)}`);
    }
    if (spec.sectionIds?.length) {
      parts.push(list(spec.sectionIds, names?.sections));
    }
    return parts.length ? `Parents of ${parts.join(" + ")}` : "All parents";
  }

  if (spec.kind === "fee_stage") {
    return `Families at fee stage ${spec.stages.join(", ")}`;
  }

  return `${spec.studentIds.length} selected student${
    spec.studentIds.length === 1 ? "" : "s"
  }`;
}
