import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { getCanvaDesign, getCanvaDesignDataset } from "@/lib/canva.server";
import { parseCanvaDesignId, planCanvaFill } from "@/lib/canvaBirthday";
import { canvaCardValues, ensureCanvaBirthdayCard, readCanvaBirthdayCard } from "@/lib/canvaBirthday.server";
import { birthdaysOn, istNow, readBirthdayState, staffBirthdaysOn } from "@/lib/birthday.server";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Students → Birthdays → "Your Canva design".
 *   { action: "check", design, subject? } → the design's fields and what the ERP will put in each.
 *   { action: "test", design, subject, id?, date? } → make a real card now (someone with a birthday
 *     on that date) and return the PNG to preview.
 */
export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return NextResponse.json({ ok: false, error: "Sign in" }, { status: 401 });
  const masters = loadMasters();
  const body = (await req.json().catch(() => ({}))) as { action?: string; design?: string; subject?: string; id?: string; date?: string };
  const subject = body.subject === "staff" ? "staff" : "student";
  const rbacModule = subject === "staff" ? "staff" : "students";
  if (!hasPermission(session, masters, rbacModule, body.action === "test" ? "edit" : "view")) {
    return NextResponse.json({ ok: false, error: `${rbacModule === "staff" ? "Staff" : "Students"} access required` }, { status: 403 });
  }
  const designId = parseCanvaDesignId(String(body.design || ""));
  if (!designId) return NextResponse.json({ ok: false, error: "Paste the Canva design's link (Share → Copy link) or its id" }, { status: 400 });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? String(body.date) : istNow().date;
  const settings = (await readBirthdayState()).settings;

  // Whose card to fill: the named person, else someone with a birthday that day, else nobody → sample values.
  let id = String(body.id || "");
  let age: number | null = null;
  if (!id) {
    if (subject === "staff") {
      const s = (await staffBirthdaysOn(date))[0];
      if (s) ({ staffId: id, age } = s);
    } else {
      const s = (await birthdaysOn(date))[0];
      if (s) ({ studentId: id, age } = s);
    }
  }

  try {
    if (body.action === "check") {
      const [design, dataset] = await Promise.all([getCanvaDesign(designId), getCanvaDesignDataset(designId)]);
      const v = id ? await canvaCardValues({ subject, id, date, age }, settings.cardWish) : null;
      const values =
        v && !("error" in v)
          ? v.values
          : { name: "Aarav Sharma", className: subject === "staff" ? "Teacher" : "Class VI · A", age: 11, wish: settings.cardWish || "Wishing you a wonderful year ahead!", schoolName: "BHB INTERNATIONAL SCHOOL", dateLabel: date, signature: "Principal" };
      const plan = planCanvaFill(dataset, values);
      return NextResponse.json({ ok: true, designId, title: design.title, fields: dataset, plan, sampleFor: v && !("error" in v) ? values.name : "" });
    }
    if (body.action === "test") {
      if (!id) {
        return NextResponse.json({ ok: false, error: `Nobody ${subject === "staff" ? "on the staff" : "in the school"} has a birthday on ${date} — pick a date that has one to make a test card` }, { status: 400 });
      }
      const r = await ensureCanvaBirthdayCard({ subject, id, date, age }, designId, settings.cardWish, true);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
      // Shown straight from storage, so a design not saved in settings yet can still be previewed.
      const png = await readCanvaBirthdayCard(subject, id, date, designId);
      const preview = png ? `data:image/png;base64,${Buffer.from(png).toString("base64")}` : "";
      return NextResponse.json({ ok: true, designId, canvaDesignId: r.canvaDesignId, usesRemaining: r.usesRemaining, plan: r.plan, preview });
    }
    return NextResponse.json({ ok: false, error: "action must be check or test" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
