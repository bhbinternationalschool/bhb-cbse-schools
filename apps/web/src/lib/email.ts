/**
 * Email channel — shared (client + server) types and settings shape.
 * Delivery is Google Workspace Gmail API (lib/email.server.ts): the ERP
 * sends *as* a Workspace mailbox chosen per purpose — admissions mail from
 * admissions@, fee / receipt mail from the accounts mailbox, reports from
 * the principal, everything else from a general office address — through a
 * service account with domain-wide delegation. Settings live in
 * module_local_state ("email_settings") and are edited via /api/email/settings.
 */

export type EmailPurpose = "admissions" | "fees" | "reports" | "general";

export const EMAIL_PURPOSES: { id: EmailPurpose; label: string; hint: string; rbac: "admissions" | "fees" | "notices" }[] = [
  { id: "admissions", label: "Admissions", hint: "Follow-ups, offer / deficiency letters, marketing to prospects", rbac: "admissions" },
  { id: "fees", label: "Fees & receipts", hint: "Receipts, fee reminders, statements", rbac: "fees" },
  { id: "reports", label: "Reports & leadership", hint: "Scheduled reports, digests to management", rbac: "notices" },
  { id: "general", label: "General office", hint: "Notices, circulars, anything else", rbac: "notices" },
];

export type EmailSender = { address: string; name: string };

export type EmailSettings = {
  version: 1;
  enabled: boolean;
  senders: Record<EmailPurpose, EmailSender>;
  /** Reply-To for every mail ("" = the sender) */
  replyTo: string;
  /** Plain-text footer appended to every mail */
  footer: string;
  updatedAt: string;
  updatedBy: string;
};

export type EmailLogEntry = {
  id: string;
  at: string;
  purpose: EmailPurpose;
  from: string;
  to: string;
  subject: string;
  status: "sent" | "failed";
  detail: string;
  by: string;
  /** What it was about, e.g. "lead:adm_123", "receipt:rcpt_9" */
  ref: string;
};

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(v: string): boolean {
  return EMAIL_RE.test((v || "").trim());
}

export function defaultEmailSettings(domain = "bhbinternational.school"): EmailSettings {
  return {
    version: 1,
    enabled: true,
    senders: {
      admissions: { address: `admissions@${domain}`, name: "Admissions" },
      fees: { address: `accounts@${domain}`, name: "Accounts" },
      reports: { address: `principal@${domain}`, name: "Principal's office" },
      general: { address: `office@${domain}`, name: "School office" },
    },
    replyTo: "",
    footer: "",
    updatedAt: "",
    updatedBy: "",
  };
}

export function normalizeEmailSettings(raw: unknown, domain?: string): EmailSettings {
  const d = defaultEmailSettings(domain);
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<EmailSettings>;
  const senders = { ...d.senders };
  for (const p of EMAIL_PURPOSES) {
    const s = (r.senders as Record<string, Partial<EmailSender>> | undefined)?.[p.id];
    if (s) {
      const address = str(s.address, 120).toLowerCase();
      senders[p.id] = { address: isEmailAddress(address) ? address : d.senders[p.id].address, name: str(s.name, 80) || d.senders[p.id].name };
    }
  }
  const replyTo = str(r.replyTo, 120).toLowerCase();
  return {
    version: 1,
    enabled: r.enabled !== false,
    senders,
    replyTo: isEmailAddress(replyTo) ? replyTo : "",
    footer: str(r.footer, 600),
    updatedAt: str(r.updatedAt, 40),
    updatedBy: str(r.updatedBy, 120),
  };
}

/** Which mailbox a purpose sends from. */
export function senderFor(settings: EmailSettings, purpose: EmailPurpose): EmailSender {
  return settings.senders[purpose] || settings.senders.general;
}

/* ─── MIME (pure, testable) ────────────────────────────────────────── */

export type EmailAttachment = { filename: string; contentType: string; /** base64 */ contentBase64: string };

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}
function encodeHeader(v: string): string {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`;
}
function wrap76(s: string): string {
  return s.replace(/(.{76})/g, "$1\r\n");
}

/** RFC 2822 message, returned as base64url for gmail.users.messages.send. */
export function buildMimeMessage(m: {
  from: EmailSender;
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}): { raw: string; mime: string } {
  const boundaryAlt = `alt_${Math.random().toString(36).slice(2)}`;
  const boundaryMix = `mix_${Math.random().toString(36).slice(2)}`;
  const headers = [
    `From: ${m.from.name ? `${encodeHeader(m.from.name)} <${m.from.address}>` : m.from.address}`,
    `To: ${m.to.join(", ")}`,
    ...(m.cc?.length ? [`Cc: ${m.cc.join(", ")}`] : []),
    ...(m.replyTo ? [`Reply-To: ${m.replyTo}`] : []),
    `Subject: ${encodeHeader(m.subject)}`,
    "MIME-Version: 1.0",
  ];
  const textPart = `Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(m.text))}`;
  const htmlPart = m.html ? `Content-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(m.html))}` : "";
  const bodyAlt = m.html
    ? `Content-Type: multipart/alternative; boundary="${boundaryAlt}"\r\n\r\n--${boundaryAlt}\r\n${textPart}\r\n--${boundaryAlt}\r\n${htmlPart}\r\n--${boundaryAlt}--`
    : textPart;
  let mime: string;
  if (m.attachments?.length) {
    const parts = m.attachments.map(
      (a) => `--${boundaryMix}\r\nContent-Type: ${a.contentType}; name="${a.filename}"\r\nContent-Disposition: attachment; filename="${a.filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(a.contentBase64)}`,
    );
    mime = `${headers.join("\r\n")}\r\nContent-Type: multipart/mixed; boundary="${boundaryMix}"\r\n\r\n--${boundaryMix}\r\n${bodyAlt}\r\n${parts.join("\r\n")}\r\n--${boundaryMix}--`;
  } else {
    mime = `${headers.join("\r\n")}\r\n${bodyAlt}`;
  }
  const raw = Buffer.from(mime, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { raw, mime };
}

/** Plain text → minimal HTML (paragraphs + line breaks), escaped. */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2937">${text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
}
