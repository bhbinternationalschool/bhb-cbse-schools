"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Gift, IndianRupee, Power, RefreshCw } from "lucide-react";
import { loadSis, studentsInSession } from "@/lib/sis";
import { currentAcademicYearCode, type MastersState } from "@/lib/masters";
import { freeUntilLabel, type TutorAccessRule } from "@/lib/tutorAccess";
import type { TutorPlan } from "@/lib/tutorPlans";

const field = "rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm";

/**
 * Tutor passes: what they cost, who gets them free, and until when.
 *
 * Before this screen existed the prices lived in an environment variable and
 * "free" meant one 24-hour trial per child — so making the school's own
 * tutor free for the school's own exam week needed a developer and a
 * deploy. Everything here takes effect within a minute.
 */
export function TutorPassesPanel(props: { state: MastersState; canEdit: boolean }) {
  const [plans, setPlans] = useState<TutorPlan[]>([]);
  const [rules, setRules] = useState<TutorAccessRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [kind, setKind] = useState<"free" | "discount">("free");
  const [scope, setScope] = useState<"all" | "class" | "student">("all");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [studentQuery, setStudentQuery] = useState("");
  const [freeUntil, setFreeUntil] = useState("");
  const [percent, setPercent] = useState("50");
  const [note, setNote] = useState("");

  const classes = props.state.classes ?? [];
  const students = useMemo(() => {
    const ay = currentAcademicYearCode(props.state);
    return studentsInSession(loadSis(), ay).filter((s) => s.status === "active");
  }, [props.state]);

  const matches = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return students
      .filter((s) => `${s.fullName} ${s.admissionNo ?? ""}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [students, studentQuery]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/tutor/access");
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; data?: { plans: TutorPlan[]; rules: TutorAccessRule[] }; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.ok) {
        return setError(body?.error?.message || "Could not read the tutor settings");
      }
      setPlans(body.data?.plans ?? []);
      setRules(body.data?.rules ?? []);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(payload: Record<string, unknown>, done: string) {
    setError(null);
    setNotice(null);
    const res = await fetch("/api/v1/tutor/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: { message?: string } }
      | null;
    if (!res.ok || !body?.ok) return setError(body?.error?.message || "That did not work");
    setNotice(done);
    await load();
  }

  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const liveFree = rules.filter((r) => r.isActive && r.kind === "free" && (r.freeUntil ?? "") >= today);

  function scopeLabel(r: TutorAccessRule): string {
    if (r.scope === "all") return "Every child";
    if (r.scope === "class") return classes.find((c) => c.id === r.scopeId)?.name ?? "A class";
    return students.find((s) => s.id === r.scopeId)?.fullName ?? "One child";
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <Gift className="h-4 w-4 text-[var(--brand-deep)]" aria-hidden />
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Tutor passes &amp; free access</h3>
        <button type="button" className={`${field} ml-auto text-xs`} onClick={() => void load()} disabled={busy}>
          <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden />
          {busy ? "Reading…" : "Refresh"}
        </button>
      </header>

      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
      {notice ? <p className="text-xs text-[var(--success)]">{notice}</p> : null}

      {liveFree.length ? (
        <p className="rounded-lg bg-[var(--success-soft)] px-3 py-2 text-xs text-[var(--success)]">
          The tutor is free right now for {liveFree.map(scopeLabel).join(", ")} —{" "}
          {liveFree.map((r) => freeUntilLabel(r.freeUntil!, false)).join(", ")}. Nobody in that group is asked to pay.
        </p>
      ) : (
        <p className="text-xs text-[var(--muted)]">No free window is running. Families pay the prices below.</p>
      )}

      {/* ── prices ───────────────────────────────────────────────── */}
      <div className="space-y-2 rounded-xl border border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--brand-deep)]">
          <IndianRupee className="h-3 w-3" aria-hidden /> What a pass costs
        </div>
        <ul className="space-y-2">
          {plans.map((p) => (
            <li key={p.code} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-[7rem] font-medium">{p.label}</span>
              <span className="text-xs text-[var(--muted)]">{p.days} day{p.days === 1 ? "" : "s"}</span>
              <span className="text-xs text-[var(--muted)]">₹</span>
              <input
                className={`${field} w-24`}
                type="number"
                min={0}
                defaultValue={Math.round(p.pricePaise / 100)}
                disabled={!props.canEdit}
                onBlur={(e) => {
                  const rupees = Number(e.target.value);
                  if (!Number.isFinite(rupees) || rupees === Math.round(p.pricePaise / 100)) return;
                  void post(
                    { action: "price", code: p.code, label: p.label, days: p.days, priceRupees: rupees },
                    `${p.label} is now ₹${rupees}`,
                  );
                }}
              />
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-[var(--muted)]">
          These are the prices on the website and WhatsApp. Prices inside the Android app are set in the Play
          Console and cannot be changed from here — a free window still applies there, because access is decided
          by the school, not by Google.
        </p>
      </div>

      {/* ── grants ───────────────────────────────────────────────── */}
      {props.canEdit ? (
        <div className="space-y-2 rounded-xl border border-dashed border-[var(--border)] px-4 py-3">
          <div className="text-xs font-semibold text-[var(--brand-deep)]">Give free access, or a discount</div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select className={field} value={kind} onChange={(e) => setKind(e.target.value as "free" | "discount")}>
              <option value="free">Free tutor</option>
              <option value="discount">Discount on passes</option>
            </select>
            <span className="text-xs text-[var(--muted)]">for</span>
            <select className={field} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="all">every child in the school</option>
              <option value="class">chosen classes</option>
              <option value="student">chosen children</option>
            </select>
            {kind === "free" ? (
              <>
                <span className="text-xs text-[var(--muted)]">until</span>
                <input className={field} type="date" value={freeUntil} onChange={(e) => setFreeUntil(e.target.value)} />
              </>
            ) : (
              <>
                <input
                  className={`${field} w-20`}
                  type="number"
                  min={1}
                  max={100}
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                />
                <span className="text-xs text-[var(--muted)]">% off, until (optional)</span>
                <input className={field} type="date" value={freeUntil} onChange={(e) => setFreeUntil(e.target.value)} />
              </>
            )}
          </div>

          {scope === "class" ? (
            <div className="flex flex-wrap gap-1">
              {classes.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`${field} text-xs ${classIds.includes(c.id) ? "bg-[var(--info-soft)] font-semibold" : ""}`}
                  onClick={() =>
                    setClassIds((ids) => (ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id]))
                  }
                >
                  {c.name}
                </button>
              ))}
            </div>
          ) : null}

          {scope === "student" ? (
            <div className="space-y-1">
              <input
                className={`${field} w-full`}
                placeholder="Type a child's name or admission number…"
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
              />
              {matches.length ? (
                <div className="flex flex-wrap gap-1">
                  {matches.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`${field} text-xs ${studentIds.includes(s.id) ? "bg-[var(--info-soft)] font-semibold" : ""}`}
                      onClick={() =>
                        setStudentIds((ids) => (ids.includes(s.id) ? ids.filter((x) => x !== s.id) : [...ids, s.id]))
                      }
                    >
                      {s.fullName}
                    </button>
                  ))}
                </div>
              ) : null}
              {studentIds.length ? (
                <p className="text-[11px] text-[var(--muted)]">{studentIds.length} child(ren) chosen</p>
              ) : null}
            </div>
          ) : null}

          <input
            className={`${field} w-full`}
            placeholder="Why (optional) — e.g. half-yearly exam week"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            className={`${field} text-xs font-semibold`}
            disabled={kind === "free" && !freeUntil}
            onClick={() =>
              post(
                {
                  action: "grant",
                  kind,
                  scope,
                  scopeIds: scope === "class" ? classIds : scope === "student" ? studentIds : [],
                  freeUntil: freeUntil || null,
                  discountPercent: kind === "discount" ? Number(percent) : null,
                  note,
                },
                kind === "free" ? "Free access given" : "Discount set",
              )
            }
          >
            Save
          </button>
        </div>
      ) : null}

      {/* ── what is in force ─────────────────────────────────────── */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Grants</h4>
        {rules.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">Nothing given yet.</p>
        ) : (
          <ul className="space-y-1">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs">
                <span className="font-semibold text-[var(--brand-deep)]">
                  {r.kind === "free" ? "Free tutor" : `${r.discountPercent}% off`}
                </span>
                <span>{scopeLabel(r)}</span>
                {r.freeUntil ? <span className="text-[var(--muted)]">until {r.freeUntil}</span> : null}
                {r.note ? <span className="text-[var(--muted)]">· {r.note}</span> : null}
                {r.createdBy ? <span className="text-[var(--muted)]">· by {r.createdBy}</span> : null}
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 ${
                    r.isActive && (!r.freeUntil || r.freeUntil >= today)
                      ? "bg-[var(--success-soft)] text-[var(--success)]"
                      : "bg-[var(--surface-sunken)] text-[var(--muted)]"
                  }`}
                >
                  {!r.isActive ? "Withdrawn" : r.freeUntil && r.freeUntil < today ? "Finished" : "In force"}
                </span>
                {props.canEdit ? (
                  <button
                    type="button"
                    className={field}
                    onClick={() => post({ action: "toggle", id: r.id, isActive: !r.isActive }, r.isActive ? "Withdrawn" : "Switched on")}
                  >
                    <Power className="mr-1 inline h-3 w-3" aria-hidden />
                    {r.isActive ? "Withdraw" : "Switch on"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
