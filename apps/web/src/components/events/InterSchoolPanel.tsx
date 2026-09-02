"use client";

/**
 * Inter-school events desk — competitions this school hosts for its own and
 * other schools' students. Server-first: everything reads and writes the
 * evt_* tables through /api/events/interschool, because the registration and
 * transparency pages are public and must see the same truth.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
} from "@/components/ui/erp-roster";
import QRCode from "qrcode";
import { EventPublicity } from "@/components/events/EventPublicity";
import { formatInr, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

type Category = {
  id: string;
  name: string;
  classBand: string;
  prize1Paise: number;
  prize2Paise: number;
  prize3Paise: number;
  prizeNotes: string;
  resultsLockedAt: string;
  lockedBy: string;
  sortOrder: number;
};

type Evt = {
  id: string;
  name: string;
  slug: string;
  eventDate: string;
  venue: string;
  description: string;
  registrationClosesOn: string;
  entryFeePaise: number;
  otherCostsPaise: number;
  status: "draft" | "open" | "closed" | "completed";
  categories: Category[];
};

type Participant = {
  id: string;
  categoryId: string;
  studentName: string;
  schoolName: string;
  classLabel: string;
  guardianMobile: string;
  isOwnStudent: boolean;
  status: "pending" | "approved" | "rejected";
  feeStatus: "na" | "due" | "paid";
  feePaise: number;
  paymentRef: string;
  score: number | null;
  rank: number | null;
};

type Certificate = {
  id: string;
  participantId: string;
  kind: string;
  rank: number | null;
};

type CatDraft = {
  id?: string;
  name: string;
  classBand: string;
  prize1: string;
  prize2: string;
  prize3: string;
  prizeNotes: string;
};

const API = "/api/events/interschool";

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function rupees(paise: number): string {
  return String(paise / 100);
}
function toPaise(rupeesStr: string): number {
  return Math.max(0, Math.round((Number(rupeesStr) || 0) * 100));
}

export function InterSchoolPanel({
  readOnly,
  cashierName,
}: {
  readOnly?: boolean;
  cashierName: string;
}) {
  const [events, setEvents] = useState<Evt[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<
    "setup" | "participants" | "results" | "certificates" | "publicity"
  >("setup");

  // Setup form
  const [name, setName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [venue, setVenue] = useState("");
  const [description, setDescription] = useState("");
  const [closesOn, setClosesOn] = useState("");
  const [feeOn, setFeeOn] = useState(false);
  const [feeRupees, setFeeRupees] = useState("100");
  const [otherCostsRupees, setOtherCostsRupees] = useState("0");
  const [status, setStatus] = useState<Evt["status"]>("draft");
  const [cats, setCats] = useState<CatDraft[]>([]);

  // Own-student picker
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [pickClassId, setPickClassId] = useState("");
  const [pickSectionId, setPickSectionId] = useState("");
  const [pickCategoryId, setPickCategoryId] = useState("");
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());

  // Results
  const [resultCategoryId, setResultCategoryId] = useState("");
  const [resultDrafts, setResultDrafts] = useState<
    Record<string, { rank: string; score: string }>
  >({});

  const selected = events.find((e) => e.id === selectedId) ?? null;

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3200);
  }
  function oops(e: unknown) {
    setError(e instanceof Error ? e.message : "Something went wrong");
  }

  const reloadEvents = useCallback(async (keepId?: string) => {
    const res = await fetch(API);
    const json = (await res.json().catch(() => ({}))) as {
      events?: Evt[];
      error?: string;
    };
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    const list = json.events ?? [];
    setEvents(list);
    if (keepId) setSelectedId(keepId);
    else if (list.length > 0 && !keepId) {
      setSelectedId((prev) => prev || list[0]!.id);
    }
    return list;
  }, []);

  const reloadParticipants = useCallback(async (eventId: string) => {
    if (!eventId) return;
    const res = await fetch(`${API}?eventId=${encodeURIComponent(eventId)}`);
    const json = (await res.json().catch(() => ({}))) as {
      participants?: Participant[];
      certificates?: Certificate[];
      error?: string;
    };
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    setParticipants(json.participants ?? []);
    setCertificates(json.certificates ?? []);
  }, []);

  useEffect(() => {
    setMasters(loadMasters());
    setSis(loadSis());
    void reloadEvents()
      .catch(oops)
      .finally(() => setLoading(false));
  }, [reloadEvents]);

  useEffect(() => {
    if (!selectedId) return;
    void reloadParticipants(selectedId).catch(oops);
  }, [selectedId, reloadParticipants]);

  // Load the selected event into the setup form.
  useEffect(() => {
    if (!selected) return;
    setName(selected.name);
    setEventDate(selected.eventDate);
    setVenue(selected.venue);
    setDescription(selected.description);
    setClosesOn(selected.registrationClosesOn);
    setFeeOn(selected.entryFeePaise > 0);
    setFeeRupees(rupees(selected.entryFeePaise || 10000));
    setOtherCostsRupees(rupees(selected.otherCostsPaise));
    setStatus(selected.status);
    setCats(
      selected.categories.map((c) => ({
        id: c.id,
        name: c.name,
        classBand: c.classBand,
        prize1: rupees(c.prize1Paise),
        prize2: rupees(c.prize2Paise),
        prize3: rupees(c.prize3Paise),
        prizeNotes: c.prizeNotes,
      })),
    );
    setResultCategoryId(selected.categories[0]?.id ?? "");
    setPickCategoryId(selected.categories[0]?.id ?? "");
  }, [selectedId, selected]);

  function newEvent() {
    setSelectedId("");
    setName("");
    setEventDate("");
    setVenue("");
    setDescription("");
    setClosesOn("");
    setFeeOn(false);
    setFeeRupees("100");
    setOtherCostsRupees("0");
    setStatus("draft");
    setCats([{ name: "", classBand: "", prize1: "0", prize2: "0", prize3: "0", prizeNotes: "" }]);
    setSection("setup");
  }

  async function onSave() {
    if (readOnly || busy) return;
    setBusy(true);
    try {
      const json = await api<{ event: Evt }>({
        action: "save",
        id: selectedId || undefined,
        name,
        eventDate: eventDate || undefined,
        venue,
        description,
        registrationClosesOn: closesOn || undefined,
        entryFeePaise: feeOn ? toPaise(feeRupees) : 0,
        otherCostsPaise: toPaise(otherCostsRupees),
        status,
        categories: cats
          .filter((c) => c.name.trim())
          .map((c) => ({
            id: c.id,
            name: c.name,
            classBand: c.classBand,
            prize1Paise: toPaise(c.prize1),
            prize2Paise: toPaise(c.prize2),
            prize3Paise: toPaise(c.prize3),
            prizeNotes: c.prizeNotes,
          })),
      });
      await reloadEvents(json.event.id);
      flash(`Saved ${json.event.name}`);
    } catch (e) {
      oops(e);
    } finally {
      setBusy(false);
    }
  }

  const publicUrl = selected
    ? `https://${TENANT.publicPortal}/fest/${selected.slug}`
    : "";

  const approvedByCategory = useMemo(() => {
    const m = new Map<string, Participant[]>();
    for (const p of participants) {
      if (p.status !== "approved") continue;
      (m.get(p.categoryId) ?? m.set(p.categoryId, []).get(p.categoryId)!).push(p);
    }
    return m;
  }, [participants]);

  const ownStudentCandidates = useMemo(() => {
    if (!sis || !pickClassId) return [];
    return sis.students
      .filter(
        (s) =>
          s.status === "active" &&
          s.classId === pickClassId &&
          (!pickSectionId || s.sectionId === pickSectionId),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [sis, pickClassId, pickSectionId]);

  const certByParticipant = useMemo(() => {
    const m = new Map<string, Certificate[]>();
    for (const c of certificates) {
      (m.get(c.participantId) ?? m.set(c.participantId, []).get(c.participantId)!).push(c);
    }
    return m;
  }, [certificates]);

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading inter-school events…</p>;
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-[rgba(32,48,80,0.06)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] items-start">
        {/* Event list */}
        <div className="space-y-2">
          <button type="button" className={`${btn} w-full`} onClick={newEvent} disabled={readOnly}>
            + New event
          </button>
          {events.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setSelectedId(e.id)}
              className={`w-full rounded-xl border p-3 text-left ${
                e.id === selectedId
                  ? "border-[var(--brand-gold)] bg-[rgba(197,160,40,0.08)]"
                  : "border-[var(--border)] bg-[var(--card)]"
              }`}
            >
              <div className="text-sm font-bold text-[var(--brand-deep)]">{e.name}</div>
              <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                {e.eventDate || "date TBD"} · {e.categories.length} categories
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                    e.status === "open"
                      ? "bg-[var(--success-soft)] text-[var(--success)]"
                      : "bg-[rgba(32,48,80,0.08)] text-[var(--muted)]"
                  }`}
                >
                  {e.status}
                </span>
                {e.entryFeePaise > 0 ? (
                  <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--brand-deep)]">
                    Fee {formatInr(e.entryFeePaise)}
                  </span>
                ) : (
                  <span className="rounded bg-[rgba(32,48,80,0.08)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--muted)]">
                    Free
                  </span>
                )}
              </div>
            </button>
          ))}
          {events.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">
              No events yet — create the first one.
            </p>
          ) : null}
        </div>

        {/* Selected event */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["setup", "Setup"],
                ["participants", `Participants (${participants.length})`],
                ["results", "Results"],
                ["certificates", `Certificates (${certificates.length})`],
                ["publicity", "Publicity"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  section === id
                    ? "bg-[#203050] text-white"
                    : "border border-[var(--border)] bg-[var(--card)] text-[var(--brand-deep)]"
                }`}
              >
                {label}
              </button>
            ))}
            {selected && selected.status !== "draft" ? (
              <a
                className="ml-auto rounded-lg border border-[#128C7E] bg-[#128C7E]/10 px-3 py-1.5 text-xs font-bold text-[#0f766e]"
                href={`https://wa.me/?text=${encodeURIComponent(
                  `${selected.name} — register your students:\n${publicUrl}/register\n\nRules, participants, results and accounts (public):\n${publicUrl}`,
                )}`}
                target="_blank"
                rel="noopener"
              >
                Share on WhatsApp
              </a>
            ) : null}
          </div>

          {/* ── Setup ── */}
          {section === "setup" ? (
            <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-[var(--muted)]">
                  Event name
                  <input className={`${field} mt-1 w-full`} value={name} onChange={(e) => setName(e.target.value)} placeholder="BHB Talent Fest 2026" />
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Venue
                  <input className={`${field} mt-1 w-full`} value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="School ground" />
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Event date
                  <input type="date" className={`${field} mt-1 w-full`} value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Registration closes
                  <input type="date" className={`${field} mt-1 w-full`} value={closesOn} onChange={(e) => setClosesOn(e.target.value)} />
                </label>
              </div>

              <label className="block text-xs text-[var(--muted)]">
                Rules, judging rubric &amp; judges — published on the public page BEFORE registration opens
                <textarea className={`${field} mt-1 w-full`} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={"Judging: content 40, presentation 40, discipline 20.\nJudges: Mrs. Gupta (Quiz), Mr. Rao (Art)…"} />
              </label>

              <div className="flex flex-wrap items-end gap-4">
                <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                  <input type="checkbox" checked={feeOn} onChange={(e) => setFeeOn(e.target.checked)} />
                  Entry fee
                </label>
                {feeOn ? (
                  <label className="block text-xs text-[var(--muted)]">
                    Amount (₹) per participant — paid online via Cashfree
                    <input inputMode="decimal" className={`${field} mt-1 w-28`} value={feeRupees} onChange={(e) => setFeeRupees(e.target.value.replace(/[^\d.]/g, ""))} />
                  </label>
                ) : (
                  <span className="text-xs text-[var(--muted)]">Free entry — the fee line disappears from the public page</span>
                )}
                <label className="block text-xs text-[var(--muted)]">
                  Other costs (₹) — trophies, printing (public accounts tab)
                  <input inputMode="decimal" className={`${field} mt-1 w-28`} value={otherCostsRupees} onChange={(e) => setOtherCostsRupees(e.target.value.replace(/[^\d.]/g, ""))} />
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Status
                  <select className={`${field} mt-1 block`} value={status} onChange={(e) => setStatus(e.target.value as Evt["status"])}>
                    <option value="draft">Draft (hidden from public)</option>
                    <option value="open">Open — registration live</option>
                    <option value="closed">Closed — event day</option>
                    <option value="completed">Completed</option>
                  </select>
                </label>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-[var(--brand-deep)]">
                  Categories &amp; prize pool
                </div>
                <div className="space-y-2">
                  {cats.map((c, i) => (
                    <div key={c.id ?? `new-${i}`} className="grid gap-2 rounded-lg border border-[var(--border)] p-2 sm:grid-cols-[1fr_100px_90px_90px_90px_1fr]">
                      <input className={field} placeholder="Category (e.g. Quiz)" value={c.name} onChange={(e) => setCats((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                      <input className={field} placeholder="Classes" value={c.classBand} onChange={(e) => setCats((p) => p.map((x, j) => (j === i ? { ...x, classBand: e.target.value } : x)))} />
                      <input className={field} inputMode="decimal" placeholder="1st ₹" value={c.prize1} onChange={(e) => setCats((p) => p.map((x, j) => (j === i ? { ...x, prize1: e.target.value.replace(/[^\d.]/g, "") } : x)))} />
                      <input className={field} inputMode="decimal" placeholder="2nd ₹" value={c.prize2} onChange={(e) => setCats((p) => p.map((x, j) => (j === i ? { ...x, prize2: e.target.value.replace(/[^\d.]/g, "") } : x)))} />
                      <input className={field} inputMode="decimal" placeholder="3rd ₹" value={c.prize3} onChange={(e) => setCats((p) => p.map((x, j) => (j === i ? { ...x, prize3: e.target.value.replace(/[^\d.]/g, "") } : x)))} />
                      <input className={field} placeholder="Notes (+ Trophy)" value={c.prizeNotes} onChange={(e) => setCats((p) => p.map((x, j) => (j === i ? { ...x, prizeNotes: e.target.value } : x)))} />
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className={`${btnOutline} mt-2`}
                  onClick={() => setCats((p) => [...p, { name: "", classBand: "", prize1: "0", prize2: "0", prize3: "0", prizeNotes: "" }])}
                >
                  + Category
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                <div className="text-xs text-[var(--muted)]">
                  {selected && selected.status !== "draft" ? (
                    <>
                      Public page: <a className="font-semibold underline" href={publicUrl} target="_blank" rel="noopener">{publicUrl}</a>
                    </>
                  ) : (
                    "Set status to Open to publish the page and start registrations."
                  )}
                </div>
                <button type="button" className={btn} onClick={() => void onSave()} disabled={readOnly || busy}>
                  {selectedId ? "Save event" : "Create event"}
                </button>
              </div>
            </div>
          ) : null}

          {/* ── Participants ── */}
          {section === "participants" && selected ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--brand-deep)]">
                  Add own students (from SIS)
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <select className={`${field} w-36`} value={pickClassId} onChange={(e) => { setPickClassId(e.target.value); setPickSectionId(""); setPickedIds(new Set()); }}>
                    <option value="">Class…</option>
                    {(masters?.classes ?? []).filter((c) => c.isActive !== false).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <select className={`${field} w-32`} value={pickSectionId} onChange={(e) => setPickSectionId(e.target.value)}>
                    <option value="">All sections</option>
                    {(masters?.sections ?? []).filter((s) => s.classId === pickClassId).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <select className={`${field} w-44`} value={pickCategoryId} onChange={(e) => setPickCategoryId(e.target.value)}>
                    {selected.categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={btn}
                    disabled={readOnly || busy || pickedIds.size === 0 || !pickCategoryId}
                    onClick={() => {
                      setBusy(true);
                      void api<{ added: number }>({
                        action: "add-own",
                        eventId: selected.id,
                        categoryId: pickCategoryId,
                        sisStudentIds: [...pickedIds],
                        schoolName: TENANT.nameDisplay,
                      })
                        .then((r) => {
                          flash(`Added ${r.added} student${r.added === 1 ? "" : "s"}`);
                          setPickedIds(new Set());
                          return reloadParticipants(selected.id);
                        })
                        .catch(oops)
                        .finally(() => setBusy(false));
                    }}
                  >
                    Add {pickedIds.size || ""} to event
                  </button>
                </div>
                {pickClassId ? (
                  <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                    {ownStudentCandidates.map((s) => {
                      const on = pickedIds.has(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() =>
                            setPickedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(s.id)) next.delete(s.id);
                              else next.add(s.id);
                              return next;
                            })
                          }
                          className={`rounded-lg border px-2 py-1 text-xs ${
                            on
                              ? "border-[var(--brand-gold)] bg-[rgba(197,160,40,0.15)] font-bold"
                              : "border-[var(--border)]"
                          }`}
                        >
                          {s.fullName}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
                <ErpTable minWidth="min-w-0" className="text-sm">
                  <ErpTableHead>
                    <tr className="text-left text-[10px] uppercase text-[var(--muted)]">
                      <th className="px-3 py-2">Student</th>
                      <th className="px-3 py-2">School</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Fee</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </ErpTableHead>
                  <ErpTableBody>
                    {participants.map((p) => {
                      const cat = selected.categories.find((c) => c.id === p.categoryId);
                      return (
                        <tr key={p.id}>
                          <td className="px-3 py-2 font-semibold text-[var(--brand-deep)]">
                            {p.studentName}
                            {p.classLabel ? <span className="text-[var(--muted)]"> · {p.classLabel}</span> : null}
                          </td>
                          <td className={`px-3 py-2 ${p.isOwnStudent ? "" : "font-semibold text-[#3730a3] dark:text-[#a5b4fc]"}`}>{p.schoolName}</td>
                          <td className="px-3 py-2">{cat?.name ?? "—"}</td>
                          <td className="px-3 py-2 text-xs font-bold">
                            {p.feeStatus === "paid" ? (
                              <span className="text-[var(--success)]">Paid ✓</span>
                            ) : p.feeStatus === "due" ? (
                              <button
                                type="button"
                                className="text-[var(--warning)] underline"
                                disabled={readOnly}
                                title="Mark received in cash at the counter"
                                onClick={() => {
                                  const ref = window.prompt(`Cash/UPI ref for ${p.studentName}'s ₹${p.feePaise / 100} entry fee`, "CASH");
                                  if (ref == null) return;
                                  void api({ action: "fee-paid", participantId: p.id, paymentRef: ref || "CASH" })
                                    .then(() => reloadParticipants(selected.id))
                                    .catch(oops);
                                }}
                              >
                                Due {formatInr(p.feePaise)}
                              </button>
                            ) : (
                              <span className="text-[var(--muted)]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                p.status === "approved"
                                  ? "bg-[var(--success-soft)] text-[var(--success)]"
                                  : p.status === "rejected"
                                    ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                                    : "bg-[var(--warning-soft)] text-[var(--warning)]"
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {p.status === "pending" ? (
                              <span className="flex justify-end gap-1">
                                <button type="button" className={btnOutline} disabled={readOnly} onClick={() => void api({ action: "status", participantId: p.id, status: "approved" }).then(() => reloadParticipants(selected.id)).catch(oops)}>Approve</button>
                                <button type="button" className="rounded-lg px-2 py-1 text-xs font-semibold text-[var(--danger)]" disabled={readOnly} onClick={() => void api({ action: "status", participantId: p.id, status: "rejected" }).then(() => reloadParticipants(selected.id)).catch(oops)}>Reject</button>
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                    {participants.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-[var(--muted)]">No registrations yet — share the public link.</td></tr>
                    ) : null}
                  </ErpTableBody>
                </ErpTable>
              </div>
            </div>
          ) : null}

          {/* ── Results ── */}
          {section === "results" && selected ? (
            <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <select className={`${field} w-56`} value={resultCategoryId} onChange={(e) => setResultCategoryId(e.target.value)}>
                  {selected.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.resultsLockedAt ? " · LOCKED" : ""}
                    </option>
                  ))}
                </select>
                {(() => {
                  const cat = selected.categories.find((c) => c.id === resultCategoryId);
                  if (!cat) return null;
                  return cat.resultsLockedAt ? (
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-[var(--success-soft)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--success)]">
                        Locked &amp; public · {cat.resultsLockedAt.slice(0, 10)}
                      </span>
                      <button
                        type="button"
                        className="rounded-lg px-2 py-1 text-xs font-semibold text-[var(--danger)]"
                        disabled={readOnly}
                        onClick={() => {
                          const reason = window.prompt("Reopening locked results is a PUBLIC act. Reason (shown on the public page):");
                          if (!reason?.trim()) return;
                          void api({ action: "unlock", categoryId: cat.id, reason })
                            .then(() => reloadEvents(selected.id))
                            .then(() => flash("Unlocked — the reason is on the public record"))
                            .catch(oops);
                        }}
                      >
                        Unlock (public reason)
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={btn}
                      disabled={readOnly}
                      onClick={() => {
                        if (!window.confirm("Lock results for this category? The full scoreboard goes public for everyone at the same moment.")) return;
                        void api({ action: "lock", categoryId: cat.id })
                          .then(() => reloadEvents(selected.id))
                          .then(() => flash("Locked — scoreboard is now public"))
                          .catch(oops);
                      }}
                    >
                      Lock &amp; publish results
                    </button>
                  );
                })()}
              </div>

              <div className="space-y-1.5">
                {(approvedByCategory.get(resultCategoryId) ?? []).map((p) => {
                  const d = resultDrafts[p.id] ?? {
                    rank: p.rank == null ? "" : String(p.rank),
                    score: p.score == null ? "" : String(p.score),
                  };
                  const locked = !!selected.categories.find((c) => c.id === resultCategoryId)?.resultsLockedAt;
                  return (
                    <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-bold text-[var(--brand-deep)]">{p.studentName}</span>
                        <span className={`ml-2 text-xs ${p.isOwnStudent ? "text-[var(--muted)]" : "font-semibold text-[#3730a3] dark:text-[#a5b4fc]"}`}>{p.schoolName}</span>
                      </div>
                      <label className="text-[10px] text-[var(--muted)]">Rank
                        <input className={`${field} ml-1 !inline-block w-14 !py-1`} inputMode="numeric" disabled={locked} value={d.rank} onChange={(e) => setResultDrafts((prev) => ({ ...prev, [p.id]: { ...d, rank: e.target.value.replace(/\D/g, "") } }))} />
                      </label>
                      <label className="text-[10px] text-[var(--muted)]">Score
                        <input className={`${field} ml-1 !inline-block w-16 !py-1`} inputMode="decimal" disabled={locked} value={d.score} onChange={(e) => setResultDrafts((prev) => ({ ...prev, [p.id]: { ...d, score: e.target.value.replace(/[^\d.]/g, "") } }))} />
                      </label>
                      <button
                        type="button"
                        className={btnOutline}
                        disabled={readOnly || locked}
                        onClick={() =>
                          void api({
                            action: "result",
                            participantId: p.id,
                            rank: d.rank === "" ? null : Number(d.rank),
                            score: d.score === "" ? null : Number(d.score),
                          })
                            .then(() => reloadParticipants(selected.id))
                            .then(() => flash("Saved"))
                            .catch(oops)
                        }
                      >
                        Save
                      </button>
                      {p.rank != null && p.rank <= 3 ? (
                        <RankPrize selected={selected} p={p} readOnly={readOnly} onDone={() => void reloadParticipants(selected.id)} onError={oops} by={cashierName} />
                      ) : null}
                    </div>
                  );
                })}
                {(approvedByCategory.get(resultCategoryId) ?? []).length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">No approved participants in this category yet.</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* ── Certificates ── */}
          {section === "certificates" && selected ? (
            <CertificatesSection
              event={selected}
              participants={participants}
              certificates={certificates}
              certByParticipant={certByParticipant}
              readOnly={readOnly}
              busy={busy}
              onIssue={() => {
                setBusy(true);
                void api<{ issued: { winners: number; participation: number } }>({
                  action: "certificates",
                  eventId: selected.id,
                })
                  .then((r) => {
                    flash(`Issued — ${r.issued.winners} winner, ${r.issued.participation} participation`);
                    return reloadParticipants(selected.id);
                  })
                  .catch(oops)
                  .finally(() => setBusy(false));
              }}
            />
          ) : null}

          {/* ── Publicity ── */}
          {section === "publicity" && selected ? (
            selected.status === "draft" ? (
              <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted)]">
                Set the event status to <span className="font-bold">Open</span> first —
                publicity links point at the public page, which stays hidden while the
                event is a draft.
              </p>
            ) : (
              <EventPublicity event={selected} readOnly={readOnly} />
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RankPrize({
  selected,
  p,
  readOnly,
  onDone,
  onError,
  by,
}: {
  selected: Evt;
  p: Participant;
  readOnly?: boolean;
  onDone: () => void;
  onError: (e: unknown) => void;
  by: string;
}) {
  const cat = selected.categories.find((c) => c.id === p.categoryId);
  const amount =
    p.rank === 1 ? cat?.prize1Paise : p.rank === 2 ? cat?.prize2Paise : cat?.prize3Paise;
  if (!amount) return null;
  return (
    <button
      type="button"
      className="rounded-lg bg-[var(--brand-gold)]/20 px-2 py-1 text-xs font-bold text-[var(--brand-deep)]"
      disabled={readOnly}
      title={`Record prize handover by ${by}`}
      onClick={() => {
        if (!window.confirm(`Record ${formatInr(amount)} prize handed to ${p.studentName}? Shows on the public accounts.`)) return;
        void api({ action: "payout", participantId: p.id, amountPaise: amount })
          .then(onDone)
          .catch(onError);
      }}
    >
      Prize {formatInr(amount)} →
    </button>
  );
}

function CertificatesSection({
  event,
  participants,
  certificates,
  certByParticipant,
  readOnly,
  busy,
  onIssue,
}: {
  event: Evt;
  participants: Participant[];
  certificates: Certificate[];
  certByParticipant: Map<string, Certificate[]>;
  readOnly?: boolean;
  busy: boolean;
  onIssue: () => void;
}) {
  const winners = certificates.filter((c) => c.kind === "winner").length;
  const participation = certificates.filter((c) => c.kind === "participation").length;
  const origin = `https://${TENANT.publicPortal}`;
  const [qrById, setQrById] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      certificates.map(async (c) => {
        const url = await QRCode.toDataURL(`${origin}/fest/verify/${c.id}`, {
          width: 160,
          margin: 0,
          errorCorrectionLevel: "M",
          color: { dark: "#203050", light: "#ffffff" },
        });
        return [c.id, url] as const;
      }),
    ).then((pairs) => {
      if (!cancelled) setQrById(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [certificates, origin]);

  function printAll() {
    document.body.classList.add("printing-evt-certs");
    window.print();
    window.setTimeout(() => document.body.classList.remove("printing-evt-certs"), 400);
  }

  const byId = new Map(participants.map((p) => [p.id, p] as const));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="text-sm text-[var(--brand-deep)]">
          <span className="font-bold">{winners}</span> winner ·{" "}
          <span className="font-bold">{participation}</span> participation
        </div>
        <button type="button" className={btn} disabled={readOnly || busy} onClick={onIssue}>
          Issue / refresh certificates
        </button>
        {certificates.length > 0 ? (
          <button type="button" className={btnOutline} onClick={printAll}>
            Print all ({certificates.length})
          </button>
        ) : null}
        <span className="text-[11px] text-[var(--muted)]">
          Winners need locked results. Each certificate carries a QR-verifiable link.
        </span>
      </div>

      <div className="evt-cert-sheet print-target space-y-4">
        {certificates.map((c) => {
          const p = byId.get(c.participantId);
          if (!p) return null;
          const cat = event.categories.find((x) => x.id === p.categoryId);
          const verifyUrl = `${origin}/fest/verify/${c.id}`;
          const place =
            c.rank === 1 ? "FIRST PLACE" : c.rank === 2 ? "SECOND PLACE" : c.rank === 3 ? "THIRD PLACE" : "";
          return (
            <div key={c.id} className="evt-cert-page relative mx-auto w-full max-w-[760px] rounded border-4 border-double border-[var(--brand-accent)] bg-white p-8 text-center text-[var(--brand-deep)]">
              <div className="pointer-events-none absolute inset-2 rounded border border-[var(--brand-accent)]/50" aria-hidden />
              <p className="text-[12px] font-extrabold tracking-[0.28em] text-[var(--brand-accent)]">
                {TENANT.nameDisplay.toUpperCase()}
              </p>
              <p className="mt-0.5 text-[10px] tracking-[0.12em] text-[#5a6a8a]">
                {TENANT.city?.toUpperCase?.() ?? ""} · {event.name.toUpperCase()}
              </p>
              <p className="mt-5 text-2xl font-extrabold tracking-wide">
                {c.kind === "winner" ? "CERTIFICATE OF ACHIEVEMENT" : "CERTIFICATE OF PARTICIPATION"}
              </p>
              <p className="mt-4 text-xs text-[#5a6a8a]">This is to certify that</p>
              <p className="mt-1 inline-block border-b border-[#203050]/40 px-6 pb-0.5 text-xl font-extrabold">
                {p.studentName}
              </p>
              <p className="mt-2 text-xs text-[#5a6a8a]">
                of <span className="font-bold text-[var(--brand-deep)]">{p.schoolName}</span>{" "}
                {c.kind === "winner" ? (
                  <>secured <span className="font-extrabold text-[var(--warning)]">{place}</span> in</>
                ) : (
                  <>participated in</>
                )}{" "}
                <span className="font-bold text-[var(--brand-deep)]">
                  {cat?.name}
                  {cat?.classBand ? ` (${cat.classBand})` : ""}
                </span>
              </p>
              <p className="mt-1 text-xs text-[#5a6a8a]">
                held on {event.eventDate || event.name}
              </p>
              <div className="mt-8 flex items-end justify-between text-[9px] text-[#5a6a8a]">
                <div className="w-28 border-t border-[#203050]/40 pt-1 text-left">Coordinator</div>
                <div className="text-center">
                  {qrById[c.id] ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={qrById[c.id]} alt="Verify QR" className="mx-auto h-12 w-12" />
                  ) : (
                    <div className="mx-auto h-12 w-12 rounded border border-[#203050]/30" />
                  )}
                  <div className="mt-0.5 max-w-[180px] break-all">{verifyUrl}</div>
                </div>
                <div className="w-28 border-t border-[#203050]/40 pt-1 text-right">Principal</div>
              </div>
            </div>
          );
        })}
        {certificates.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">No certificates issued yet.</p>
        ) : null}
      </div>
    </div>
  );
}
