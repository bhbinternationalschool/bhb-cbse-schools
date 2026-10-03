/**
 * Birthday cards designed in Canva — the pure half (no network).
 *
 * The office designs a card in Canva and marks the parts that change as data
 * fields, named the way they'd say them: "name", "class", "photo", "wish".
 * The ERP reads the design's field list (Get design dataset), fills what it
 * recognises, and leaves the rest as designed. Matching is forgiving — case,
 * spaces and punctuation are ignored, and a few common words map to the same
 * value — because a field the ERP silently fails to recognise prints the
 * placeholder text on a child's card.
 */

/** Scopes the integration must have ticked in the Canva Developer Portal. */
export const CANVA_SCOPES = [
  "design:content:read",
  "design:content:write",
  "design:meta:read",
  "asset:read",
  "asset:write",
] as const;

/**
 * A Canva design id from whatever the office pasted: the editor link
 * (https://www.canva.com/design/DAGxxxx/…/edit), a share/view link, or the
 * bare id. "" when nothing in it looks like one.
 */
export function parseCanvaDesignId(input: string): string {
  const v = (input || "").trim();
  if (!v) return "";
  const fromUrl = v.match(/\/design\/([A-Za-z0-9_-]{8,40})(?:[/?#]|$)/);
  if (fromUrl) return fromUrl[1]!;
  return /^[A-Za-z0-9_-]{8,40}$/.test(v) ? v : "";
}

export type CanvaFieldType = "text" | "image" | "chart" | "sheet" | string;
export type CanvaDataset = Record<string, { type: CanvaFieldType }>;

/** What the ERP knows about one birthday, ready to drop into fields. */
export type CanvaCardValues = {
  name: string;
  /** Class & section for a child; designation for staff. */
  className: string;
  age: number | null;
  wish: string;
  schoolName: string;
  dateLabel: string;
  signature: string;
};

export type CanvaTextKey = "name" | "firstName" | "className" | "age" | "wish" | "schoolName" | "dateLabel" | "signature";
export type CanvaImageKey = "photo" | "logo";

const TEXT_ALIASES: Record<CanvaTextKey, string[]> = {
  name: ["name", "fullname", "studentname", "childname", "staffname", "teachername", "birthdayname"],
  firstName: ["firstname", "first"],
  className: ["class", "classname", "classsection", "section", "grade", "designation", "role", "post"],
  age: ["age", "years", "turning"],
  wish: ["wish", "message", "greeting", "note"],
  schoolName: ["school", "schoolname"],
  dateLabel: ["date", "birthday", "birthdate", "day"],
  signature: ["signature", "sign", "signedby", "from", "principal", "director"],
};

const IMAGE_ALIASES: Record<CanvaImageKey, string[]> = {
  photo: ["photo", "picture", "pic", "image", "photograph", "childphoto", "studentphoto", "staffphoto", "face"],
  logo: ["logo", "crest", "schoollogo", "emblem"],
};

function squash(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchAlias<K extends string>(field: string, table: Record<K, string[]>): K | null {
  const k = squash(field);
  for (const [target, aliases] of Object.entries(table) as [K, string[]][]) {
    if (aliases.includes(k)) return target;
  }
  return null;
}

export type CanvaFillPlan = {
  /** Field → the text to put in it. Empty values are left out, so the design keeps its own text. */
  text: Record<string, string>;
  /** Field → which picture goes in it. */
  images: Record<string, CanvaImageKey>;
  /** Fields the ERP doesn't recognise — left as designed; shown to the office when they check a design. */
  unknown: string[];
  /** Recognised fields with nothing to put in them (e.g. an age the record doesn't have). */
  empty: string[];
};

export function textValue(key: CanvaTextKey, v: CanvaCardValues): string {
  switch (key) {
    case "name":
      return v.name;
    case "firstName":
      return v.name.trim().split(/\s+/)[0] || "";
    case "className":
      return v.className;
    case "age":
      return v.age != null && v.age > 0 ? String(v.age) : "";
    case "wish":
      return v.wish;
    case "schoolName":
      return v.schoolName;
    case "dateLabel":
      return v.dateLabel;
    case "signature":
      return v.signature;
  }
}

/** Decide what goes into each field of the design. Pure, so the field-check screen and the sender agree. */
export function planCanvaFill(dataset: CanvaDataset, values: CanvaCardValues): CanvaFillPlan {
  const plan: CanvaFillPlan = { text: {}, images: {}, unknown: [], empty: [] };
  for (const [field, def] of Object.entries(dataset)) {
    if (def?.type === "text") {
      const key = matchAlias(field, TEXT_ALIASES);
      if (!key) {
        plan.unknown.push(field);
        continue;
      }
      const text = textValue(key, values).trim();
      if (text) plan.text[field] = text.slice(0, 500);
      else plan.empty.push(field);
    } else if (def?.type === "image") {
      const key = matchAlias(field, IMAGE_ALIASES);
      if (key) plan.images[field] = key;
      else plan.unknown.push(field);
    } else {
      plan.unknown.push(field);
    }
  }
  return plan;
}

/** "student:<id>" / "staff:<id>" — the same split the card URL's HMAC uses. */
export function canvaSubjectKey(subject: "student" | "staff", id: string): string {
  return `${subject}:${id}`;
}
