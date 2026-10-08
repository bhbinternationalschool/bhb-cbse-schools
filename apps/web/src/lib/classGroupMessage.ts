/**
 * One post, worded for a class WhatsApp GROUP — the bridge while the school
 * moves off personal class groups (director, 8 Oct 2026). The teacher posts
 * in the ERP (the record, the parent app, the school number); during the
 * move they paste this same text into the old group so nobody misses it.
 *
 * Unlike the per-family message (lib/homework composeWhatsAppHomeworkNotify)
 * this names no child: a group is everyone. Pure; WhatsApp formatting only
 * (*bold*), no links that only staff can open.
 */

export type GroupPost = {
  kind: "homework" | "diary" | "notice" | "event";
  classLabel: string;
  /** ISO date the post is for. */
  date?: string;
  subject?: string;
  title?: string;
  bodyEn?: string;
  bodyHi?: string;
  /** ISO date (or date-time) work is due / the event happens. */
  dueAt?: string;
  schoolName: string;
};

const KIND: Record<GroupPost["kind"], { icon: string; en: string; hi: string }> = {
  homework: { icon: "📚", en: "Homework", hi: "गृहकार्य" },
  diary: { icon: "📒", en: "Class diary", hi: "कक्षा डायरी" },
  notice: { icon: "📢", en: "Notice", hi: "सूचना" },
  event: { icon: "📅", en: "Event", hi: "कार्यक्रम" },
};

/** "2026-10-08" → "Thu 8 Oct"; anything else passes through. */
export function groupDate(iso: string | undefined): string {
  const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return (iso || "").trim();
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return iso || "";
  // Spelled out by hand: toLocaleDateString differs between phones/browsers.
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function composeClassGroupMessage(p: GroupPost): string {
  const k = KIND[p.kind];
  const lines: string[] = [];
  const when = groupDate(p.date);
  lines.push(`${k.icon} *${k.en} / ${k.hi} — ${p.classLabel.trim()}*${when ? ` (${when})` : ""}`);
  if (p.subject?.trim()) lines.push(`*Subject / विषय:* ${p.subject.trim()}`);
  if (p.title?.trim() && p.title.trim() !== p.subject?.trim()) lines.push(`*${p.title.trim()}*`);
  const en = (p.bodyEn || "").trim();
  const hi = (p.bodyHi || "").trim();
  if (en) lines.push(en);
  if (hi && hi !== en) lines.push(hi);
  const due = groupDate(p.dueAt);
  if (due) lines.push(`*${p.kind === "event" ? "Date / दिनांक" : "Due / जमा करें"}:* ${due}`);
  lines.push("");
  lines.push(`— ${p.schoolName.trim()}`);
  // The move off groups: every post says where the official copy lives.
  lines.push("_Also in the school app and from the school's WhatsApp number. / यह स्कूल ऐप और स्कूल के व्हाट्सऐप नंबर पर भी है।_");
  return lines.join("\n");
}

/** WhatsApp's own share link: opens WhatsApp with the text, the person picks the group. */
export function waShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
