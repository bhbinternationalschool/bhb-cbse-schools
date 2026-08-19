import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getDemoSession } from "@/lib/auth";
import { BIRTHDAY_FORMATS, normalizeDesign, normalizeFormat } from "@/lib/birthdayCards";
import { renderBirthdayCard } from "@/lib/birthdayCardDesigns";
import { birthdayCardSigOk, findBirthdayCardSubject } from "@/lib/birthday.server";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Birthday card PNG. Two callers:
 *  - staff in the browser (session) — preview / download;
 *  - WhatsApp / Facebook fetching the image link we sent — no session, so the
 *    URL carries an HMAC over (student, date, design, format) signed with
 *    CRON_SECRET / WA_DISPATCH_SECRET. `sample=1` renders a demo card for the
 *    template picker (no student data) and needs a session.
 */

type FontEntry = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };
let fontCache: FontEntry[] | null = null;
async function loadFonts(origin: string): Promise<FontEntry[]> {
  if (fontCache) return fontCache;
  const files: { file: string; weight: 400 | 700 }[] = [
    { file: "NotoSansDevanagari-Regular.ttf", weight: 400 },
    { file: "NotoSansDevanagari-Bold.woff", weight: 700 },
  ];
  const out: FontEntry[] = [];
  for (const f of files) {
    let data: ArrayBuffer | null = null;
    try {
      const buf = await fs.readFile(path.join(process.cwd(), "public", "fonts", f.file));
      data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    } catch {
      try {
        const r = await fetch(`${origin}/fonts/${f.file}`);
        if (r.ok) data = await r.arrayBuffer();
      } catch {
        /* skip */
      }
    }
    if (data) out.push({ name: "Noto Sans Devanagari", data, weight: f.weight, style: "normal" });
  }
  if (out.length) fontCache = out;
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams;
  const design = normalizeDesign(q.get("design"));
  const format = normalizeFormat(q.get("format"));
  const studentId = (q.get("student") || "").slice(0, 60);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get("date") || "") ? String(q.get("date")) : new Date().toISOString().slice(0, 10);
  const sample = q.get("sample") === "1";
  const sig = q.get("sig") || "";
  const group = q.get("group") === "1";

  const session = await getDemoSession().catch(() => null);
  const staff = !!session && session.persona === "staff";
  if (!staff && !birthdayCardSigOk(sig, { studentId: group ? "group" : studentId, date, design, format })) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const origin = `${url.protocol}//${url.host}`;
  const crestUrl = TENANT.logoCrestUrl?.startsWith("http") ? TENANT.logoCrestUrl : `${origin}${TENANT.logoCrestUrl || ""}`;
  const f = BIRTHDAY_FORMATS.find((x) => x.id === format)!;
  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const wish = (q.get("wish") || "").slice(0, 120);

  let data;
  if (sample) {
    data = { studentName: "Aarav Sharma", className: "Class VI · A", dateLabel, schoolName: TENANT.nameDisplay, tagline: TENANT.tagline, crestUrl, photoUrl: "", wish };
  } else if (group) {
    const subjects = await findBirthdayCardSubject({ date, group: true });
    if (!subjects.ok) return NextResponse.json({ error: subjects.error }, { status: 404 });
    data = { studentName: "", className: "", dateLabel, schoolName: TENANT.nameDisplay, tagline: TENANT.tagline, crestUrl, photoUrl: "", wish, names: subjects.names };
  } else {
    const subject = await findBirthdayCardSubject({ date, studentId });
    if (!subject.ok) return NextResponse.json({ error: subject.error }, { status: 404 });
    const includePhoto = q.get("photo") !== "0";
    data = { studentName: subject.studentName, className: subject.className, dateLabel, schoolName: TENANT.nameDisplay, tagline: TENANT.tagline, crestUrl, photoUrl: includePhoto ? subject.photoUrl : "", wish };
  }

  const fonts = await loadFonts(origin);
  return new ImageResponse(renderBirthdayCard(design, format, data), {
    width: f.width,
    height: f.height,
    fonts: fonts.length ? fonts : undefined,
    headers: { "Cache-Control": staff ? "private, max-age=60" : "public, max-age=86400" },
  });
}
