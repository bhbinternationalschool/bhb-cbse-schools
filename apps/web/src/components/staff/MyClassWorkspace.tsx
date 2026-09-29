"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, CheckCircle2, Phone, Users, XCircle } from "lucide-react";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { uploadMedia } from "@/lib/mediaUpload";
import { BLOOD_GROUPS, STUDENT_CATEGORIES } from "@/lib/sis";

/**
 * My class — the class teacher's own records, from the phone.
 *
 * Which families the school cannot reach on WhatsApp, and the fix: the
 * teacher corrects the number (checked with Meta), the child's details and
 * the photo. Everything is saved on the server, one row at a time, and only
 * for children of the teacher's own class (GET/PATCH
 * /api/v1/staff/class-students). Director, 2026-09-29.
 */

type WaStatus = "missing" | "not_on" | "unchecked" | "on";
type Row = {
  id: string;
  admissionNo: string;
  classLabel: string;
  photoUrl: string;
  revisionAt: string;
  fields: Record<string, string>;
  household: { id: string; revisionAt: string; fields: Record<string, string> } | null;
  whatsapp: { number: string; status: WaStatus };
};
type Data = {
  verdictsAvailable: boolean;
  students: Row[];
  summary: { total: number; missing: number; notOn: number; unchecked: number };
};

const WA_BADGE: Record<WaStatus, { label: string; cls: string }> = {
  on: { label: "On WhatsApp", cls: "bg-[var(--success-soft)] text-[var(--success)]" },
  unchecked: { label: "Not checked", cls: "bg-[var(--surface-sunken)] text-[var(--muted)]" },
  not_on: { label: "Not on WhatsApp", cls: "bg-[var(--danger-soft)] text-[var(--danger)]" },
  missing: { label: "No number", cls: "bg-[var(--danger-soft)] text-[var(--danger)]" },
};

const STUDENT_FORM: { key: string; label: string; type?: "date" | "tel" | "select"; options?: { value: string; label: string }[] }[] = [
  { key: "fullName", label: "Name" },
  { key: "rollNo", label: "Roll no." },
  { key: "gender", label: "Gender", type: "select", options: [
    { value: "", label: "—" }, { value: "M", label: "Male" }, { value: "F", label: "Female" }, { value: "O", label: "Other" },
  ] },
  { key: "dob", label: "Date of birth", type: "date" },
  { key: "bloodGroup", label: "Blood group", type: "select", options: BLOOD_GROUPS.map((b) => ({ value: b, label: b || "—" })) },
  { key: "category", label: "Category", type: "select", options: STUDENT_CATEGORIES.map((c) => ({ value: c.value, label: c.label })) },
  { key: "religion", label: "Religion" },
  { key: "motherTongue", label: "Mother tongue" },
  { key: "placeOfBirth", label: "Place of birth" },
  { key: "fatherName", label: "Father's name" },
  { key: "fatherMobile", label: "Father's mobile", type: "tel" },
  { key: "motherName", label: "Mother's name" },
  { key: "motherMobile", label: "Mother's mobile", type: "tel" },
  { key: "emergencyName", label: "Emergency contact" },
  { key: "emergencyMobile", label: "Emergency mobile", type: "tel" },
];

const FAMILY_FORM: { key: string; label: string; type?: "tel" }[] = [
  { key: "guardianName", label: "Guardian name" },
  { key: "mobile", label: "Guardian mobile", type: "tel" },
  { key: "altMobile", label: "Other mobile", type: "tel" },
  { key: "address", label: "Address" },
  { key: "locality", label: "Village / locality" },
  { key: "city", label: "City" },
  { key: "pincode", label: "PIN code" },
];

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: { message?: string } | string } | null;
    if (!res.ok || !body?.ok) {
      const err = typeof body?.error === "string" ? body.error : body?.error?.message;
      return { ok: false, status: res.status, error: err || `Not saved (server said ${res.status})` };
    }
    return { ok: true, data: body.data as T };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the school server" };
  }
}

function changed(before: Record<string, string>, after: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(after)) if ((before[k] ?? "") !== v) out[k] = v;
  return out;
}

export function MyClassWorkspace() {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "wa">("wa");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<Data>("/api/v1/staff/class-students");
    if (r.ok) {
      setData(r.data);
      setLoadError(null);
    } else setLoadError(r.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    return filter === "wa" ? data.students.filter((s) => s.whatsapp.status !== "on") : data.students;
  }, [data, filter]);

  return (
    <ErpWorkspaceShell
      title="My class"
      subtitle="Your class's WhatsApp numbers, details and photos — saved straight to the school records."
      icon={<Users className="size-6" aria-hidden />}
    >
      {loadError ? (
        <p className="mt-4 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{loadError}</p>
      ) : null}
      {!data && !loadError ? <p className="mt-4 text-sm text-[var(--muted)]">Loading your class…</p> : null}

      {data ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-2">
              <p className="text-lg font-bold text-[var(--brand-deep)]">{data.summary.total}</p>
              <p className="text-[11px] text-[var(--muted)]">Children</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-2">
              <p className="text-lg font-bold text-[var(--danger)]">{data.summary.missing + data.summary.notOn}</p>
              <p className="text-[11px] text-[var(--muted)]">Not reachable on WhatsApp</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-2">
              <p className="text-lg font-bold text-[var(--brand-deep)]">{data.summary.unchecked}</p>
              <p className="text-[11px] text-[var(--muted)]">Not checked yet</p>
            </div>
          </div>
          {!data.verdictsAvailable ? (
            <p className="mt-2 text-[11px] text-[var(--warning)]">
              WhatsApp check results could not be read just now — numbers show as “Not checked”.
            </p>
          ) : null}

          <div className="mt-3 flex gap-2">
            {(["wa", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`min-h-10 rounded-xl px-3 text-sm font-semibold ${
                  filter === f
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "border border-[var(--border)] text-[var(--brand-deep)]"
                }`}
              >
                {f === "wa" ? "WhatsApp to fix" : "All children"}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">
              {filter === "wa" ? "Every family in your class is on WhatsApp." : "No children in your class."}
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--card)]">
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(openId === r.id ? null : r.id)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                  >
                    {r.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.photoUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--muted)]">
                        <Camera className="h-4 w-4" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[var(--brand-deep)]">
                        {r.fields.rollNo ? `${r.fields.rollNo}. ` : ""}
                        {r.fields.fullName}
                      </span>
                      <span className="block text-[11px] text-[var(--muted)]">
                        {r.household?.fields.guardianName || "—"} · {r.whatsapp.number || "no number"}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${WA_BADGE[r.whatsapp.status].cls}`}>
                      {WA_BADGE[r.whatsapp.status].label}
                    </span>
                  </button>
                  {openId === r.id ? (
                    <EditChild row={r} onSaved={() => void load()} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </ErpWorkspaceShell>
  );
}

function EditChild({ row, onSaved }: { row: Row; onSaved: () => void }) {
  const [wa, setWa] = useState(row.household?.fields.whatsappMobile || row.whatsapp.number || "");
  const [waCheck, setWaCheck] = useState<null | { on: boolean | null; text: string }>(null);
  const [student, setStudent] = useState<Record<string, string>>(row.fields);
  const [family, setFamily] = useState<Record<string, string>>(row.household?.fields || {});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function checkWa() {
    setWaCheck({ on: null, text: "Checking with WhatsApp…" });
    const res = await fetch("/api/wa/number-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile: wa }),
    }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { onWhatsApp?: boolean | null; error?: string } | null;
    if (!res || !j) return setWaCheck({ on: null, text: "Could not check — try again" });
    if (j.onWhatsApp === true) return setWaCheck({ on: true, text: "This number is on WhatsApp" });
    if (j.onWhatsApp === false) return setWaCheck({ on: false, text: "This number is NOT on WhatsApp — ask the family for their WhatsApp number" });
    setWaCheck({ on: null, text: j.error || "WhatsApp did not answer — you can still save it" });
  }

  async function patch(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    setMsg(null);
    const r = await api<{ updatedAt: string }>("/api/v1/staff/class-students", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: r.error });
      if (r.status === 409) onSaved();
      return false;
    }
    setMsg({ ok: true, text: okText });
    onSaved();
    return true;
  }

  async function saveWa() {
    if (!row.household) return setMsg({ ok: false, text: "This child has no family record — ask the office" });
    await patch(
      { kind: "household", id: row.household.id, revisionAt: row.household.revisionAt, patch: { whatsappMobile: wa } },
      "WhatsApp number saved for school messages",
    );
  }

  async function saveStudent() {
    const diff = changed(row.fields, student);
    if (!Object.keys(diff).length) return setMsg({ ok: true, text: "Nothing changed" });
    await patch({ kind: "student", id: row.id, revisionAt: row.revisionAt, patch: diff }, "Details saved");
  }

  async function saveFamily() {
    if (!row.household) return;
    const diff = changed(row.household.fields, family);
    delete diff.whatsappMobile;
    if (!Object.keys(diff).length) return setMsg({ ok: true, text: "Nothing changed" });
    await patch(
      { kind: "household", id: row.household.id, revisionAt: row.household.revisionAt, patch: diff },
      "Family details saved",
    );
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMsg({ ok: true, text: "Uploading photo…" });
    const up = await uploadMedia({
      file,
      visibility: "private",
      pathPrefix: `students/${row.admissionNo || row.id}`,
    });
    setBusy(false);
    if (!up.ok) return setMsg({ ok: false, text: `Photo NOT saved — ${up.error}` });
    await patch({ kind: "photo", id: row.id, revisionAt: row.revisionAt, photoUrl: up.url }, "Photo saved");
  }

  const input = "field mt-1 !py-2 w-full";
  return (
    <div className="space-y-4 border-t border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-3">
      {msg ? (
        <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}>
          {msg.text}
        </p>
      ) : null}

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">WhatsApp for school messages</h3>
        <div className="mt-1 flex gap-2">
          <input className={input} type="tel" inputMode="numeric" value={wa} onChange={(e) => { setWa(e.target.value); setWaCheck(null); }} placeholder="10-digit WhatsApp number" />
          {wa.replace(/\D/g, "").length >= 10 ? (
            <a href={`tel:+91${wa.replace(/\D/g, "").slice(-10)}`} className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)]" aria-label="Call">
              <Phone className="h-4 w-4" />
            </a>
          ) : null}
        </div>
        {waCheck ? (
          <p className={`mt-1 flex items-center gap-1 text-xs ${waCheck.on === false ? "text-[var(--danger)]" : waCheck.on ? "text-[var(--success)]" : "text-[var(--muted)]"}`}>
            {waCheck.on === true ? <CheckCircle2 className="h-3.5 w-3.5" /> : waCheck.on === false ? <XCircle className="h-3.5 w-3.5" /> : null}
            {waCheck.text}
          </p>
        ) : null}
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={() => void checkWa()} className="min-h-10 rounded-xl border border-[var(--border)] px-3 text-sm font-semibold text-[var(--brand-deep)] disabled:opacity-40">
            Check on WhatsApp
          </button>
          <button type="button" disabled={busy} onClick={() => void saveWa()} className="min-h-10 flex-1 rounded-xl bg-[var(--primary)] px-3 text-sm font-bold text-[var(--primary-foreground)] disabled:opacity-40">
            Save number
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Photo</h3>
        <label className="mt-1 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-semibold text-[var(--brand-deep)]">
          <Camera className="h-4 w-4" />
          {row.photoUrl ? "Retake / change photo" : "Take photo"}
          <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={(e) => void onPhoto(e.target.files?.[0])} />
        </label>
      </section>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Child</h3>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {STUDENT_FORM.map((f) => (
            <label key={f.key} className="block text-[11px] font-semibold text-[var(--muted)]">
              {f.label}
              {f.type === "select" ? (
                <select className={input} value={student[f.key] ?? ""} onChange={(e) => setStudent({ ...student, [f.key]: e.target.value })}>
                  {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input className={input} type={f.type === "date" ? "date" : f.type === "tel" ? "tel" : "text"} value={student[f.key] ?? ""} onChange={(e) => setStudent({ ...student, [f.key]: e.target.value })} />
              )}
            </label>
          ))}
        </div>
        <button type="button" disabled={busy} onClick={() => void saveStudent()} className="mt-2 min-h-10 w-full rounded-xl bg-[var(--primary)] px-3 text-sm font-bold text-[var(--primary-foreground)] disabled:opacity-40">
          Save child&apos;s details
        </button>
      </section>

      {row.household ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Family</h3>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {FAMILY_FORM.map((f) => (
              <label key={f.key} className="block text-[11px] font-semibold text-[var(--muted)]">
                {f.label}
                <input className={input} type={f.type === "tel" ? "tel" : "text"} value={family[f.key] ?? ""} onChange={(e) => setFamily({ ...family, [f.key]: e.target.value })} />
              </label>
            ))}
          </div>
          <button type="button" disabled={busy} onClick={() => void saveFamily()} className="mt-2 min-h-10 w-full rounded-xl border border-[var(--border)] px-3 text-sm font-bold text-[var(--brand-deep)] disabled:opacity-40">
            Save family details
          </button>
        </section>
      ) : null}

      <p className="text-[11px] text-[var(--muted)]">
        Class, admission no., Aadhaar, PEN / APAAR and documents are changed by the office.
      </p>
    </div>
  );
}
