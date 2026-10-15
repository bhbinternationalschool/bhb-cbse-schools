"use client";

/**
 * Admissions → Field survey → Team (15 Oct 2026): the survey team, each
 * member's phone (with the one-time code that registers it) and the beats.
 *
 * Read through the query kernel (GET /api/data/views/survey-team), refetched
 * when erp_versions says the team moved (another office screen, a team
 * leader's phone) — so what this screen shows is what the app sees. Every
 * change is one POST /api/admissions/survey-team through the write kernel,
 * with the revision this screen loaded. Nothing is kept in the browser.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { QueryError } from "@/components/data/QueryError";
import { MastersWorkCard } from "@/components/masters/MastersLayout";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";
import { RowActionMenu } from "@/components/ui/erp-grid";
import { invalidateDesks, useErpQuery, useStaffList } from "@/lib/data/client/hooks";
import { postSurveyTeam } from "@/lib/surveyTeamClient";
import {
  SURVEY_TEAM_DESK,
  SURVEY_TEAM_VIEW_PATH,
  parseSurveyTeamView,
  surveyMemberKey,
  type SurveyBeatRow,
  type SurveyMemberRow,
  type SurveyTeamOp,
  type SurveyTeamView,
} from "@/lib/surveyTeamShared";

const inp =
  "w-full rounded-lg border border-[var(--line,rgba(32,48,80,0.15))] bg-[var(--surface,#fff)] px-3 py-2 text-sm text-[var(--ink,inherit)]";
const btn = "rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50";

/** The team view, shared by every card that reads it (one request, one cache entry). */
export function useSurveyTeam() {
  return useErpQuery<SurveyTeamView>("survey-team", SURVEY_TEAM_VIEW_PATH, {
    desk: SURVEY_TEAM_DESK,
    parse: parseSurveyTeamView,
  });
}

function useTeamWriter() {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  async function run(op: SurveyTeamOp, okText: string): Promise<boolean> {
    setBusy(true);
    const r = await postSurveyTeam(op);
    setBusy(false);
    // Saved or refused for a newer copy: either way, show what the server holds now.
    invalidateDesks(client, [SURVEY_TEAM_DESK]);
    setNotice(r.ok ? { kind: "ok", text: okText } : { kind: "error", text: r.error });
    return r.ok;
  }
  return { run, busy, notice, setNotice };
}

function Notice({ notice }: { notice: { kind: "ok" | "error"; text: string } | null }) {
  if (!notice) return null;
  return (
    <p
      data-testid="survey-team-notice"
      role={notice.kind === "error" ? "alert" : "status"}
      className={`mb-3 rounded-lg px-3 py-2 text-[12px] font-semibold ${
        notice.kind === "ok" ? "bg-[rgba(22,101,52,0.12)] text-[var(--tone-green-ink,#166534)]" : "bg-[rgba(185,28,28,0.12)] text-[var(--danger,#b91c1c)]"
      }`}
    >
      {notice.text}
    </p>
  );
}

function hhmm(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

/** The one-time phone code, with its expiry, copy and WhatsApp share. */
function PairingCode({ pairing, onClose }: { pairing: { name: string; code: string; expiresAt: string; mobile: string }; onClose: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const left = Math.max(0, Date.parse(pairing.expiresAt) - now);
  const expired = left <= 0;
  const text = `Your BHB survey phone code is ${pairing.code}. Open the staff app → Field survey → type this code. It works once, until ${hhmm(pairing.expiresAt)}.`;
  const wa = `https://wa.me/${pairing.mobile ? `91${pairing.mobile}` : ""}?text=${encodeURIComponent(text)}`;
  return (
    <div data-testid="survey-pairing-code" className="mb-3 rounded-xl border border-[rgba(197,160,40,0.5)] bg-[rgba(197,160,40,0.1)] p-3 text-[12px]">
      <p>
        Phone code for <b>{pairing.name}</b> — on their own phone: staff app → <b>Field survey</b> (or the website <b>/survey-day</b>) → type:
      </p>
      <p className={`my-1 font-mono text-3xl font-bold tracking-[0.3em] ${expired ? "text-[var(--muted)] line-through" : "text-[var(--brand-deep)]"}`}>
        {pairing.code}
      </p>
      <p className="text-[var(--muted)]">
        {expired
          ? "Expired — make a new code."
          : `Works once · expires in ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")} (at ${hhmm(pairing.expiresAt)}). Making another code cancels this one.`}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 font-semibold"
          disabled={expired}
          onClick={() => {
            void navigator.clipboard?.writeText(pairing.code).then(() => setCopied(true), () => setCopied(false));
          }}
        >
          {copied ? "Copied" : "Copy code"}
        </button>
        <a
          className={`rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 font-semibold ${expired ? "pointer-events-none opacity-50" : ""}`}
          href={wa}
          target="_blank"
          rel="noreferrer"
        >
          Send on WhatsApp
        </a>
        <button type="button" className="px-2 py-1.5 underline" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

export function SurveyTeamCard() {
  const query = useSurveyTeam();
  const staffList = useStaffList();
  const { run, busy, notice, setNotice } = useTeamWriter();
  const [staffId, setStaffId] = useState("");
  const [asLeader, setAsLeader] = useState(false);
  const [extName, setExtName] = useState("");
  const [extMobile, setExtMobile] = useState("");
  const [extNote, setExtNote] = useState("");
  const [pairing, setPairing] = useState<{ name: string; code: string; expiresAt: string; mobile: string } | null>(null);

  const view = query.data;
  const canEdit = view?.canEdit ?? false;
  const members = useMemo(() => view?.members ?? [], [view]);
  const beats = view?.beats ?? [];
  const onTeam = useMemo(() => new Set(members.filter((m) => m.kind === "staff").map((m) => m.staffId)), [members]);
  const available = (staffList.data?.staff ?? [])
    .filter((s) => s.status === "active" && !onTeam.has(s.id))
    .sort((a, b) => a.empCode.localeCompare(b.empCode));
  const beatName = (id: string) => beats.find((b) => b.id === id)?.name || "—";

  async function pair(m: SurveyMemberRow) {
    setNotice(null);
    const r = await postSurveyTeam({ op: "pair_start", memberId: m.id });
    if (r.ok && r.code && r.expiresAt) setPairing({ name: m.fullName, code: r.code, expiresAt: r.expiresAt, mobile: m.mobile });
    else if (!r.ok) setNotice({ kind: "error", text: r.error });
  }

  return (
    <MastersWorkCard
      title="Survey team"
      hint="Who surveys, who leads, where each starts, which beats · the phone code that registers a surveyor's phone"
    >
      <div data-testid="survey-team-card">
        {query.isError && !view ? <QueryError what="the survey team" error={query.error} retry={() => query.refetch()} /> : null}
        {query.isPending ? <p className="text-[12px] text-[var(--muted)]">Loading the survey team…</p> : null}
        <Notice notice={notice} />
        {pairing ? <PairingCode pairing={pairing} onClose={() => setPairing(null)} /> : null}

        {view && canEdit ? (
          <div className="mb-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-[rgba(32,48,80,0.1)] p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--brand-deep)]">Add school staff</p>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <select aria-label="Staff to add" className={inp} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                  <option value="">Select staff…</option>
                  {available.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.empCode} — {s.fullName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={btn}
                  disabled={busy || !staffId}
                  onClick={async () => {
                    const name = available.find((s) => s.id === staffId)?.fullName || "Staff";
                    if (await run({ op: "member_add_staff", staffId, leader: asLeader }, `${name} added${asLeader ? " as team leader" : ""} — the app shows Start survey`)) {
                      setStaffId("");
                      setAsLeader(false);
                    }
                  }}
                >
                  Add to team
                </button>
              </div>
              <label className="mt-2 flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={asLeader} onChange={(e) => setAsLeader(e.target.checked)} />
                Make team leader (replaces the current leader)
              </label>
            </div>
            <div className="rounded-lg border border-[rgba(32,48,80,0.1)] p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--brand-deep)]">Outside surveyor (survey work only)</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input className={inp} placeholder="Full name *" value={extName} onChange={(e) => setExtName(e.target.value)} />
                <input
                  className={inp}
                  placeholder="Mobile *"
                  inputMode="numeric"
                  maxLength={10}
                  value={extMobile}
                  onChange={(e) => setExtMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                />
              </div>
              <input className={`${inp} mt-2`} placeholder="Note (agency / beat hire)" value={extNote} onChange={(e) => setExtNote(e.target.value)} />
              <button
                type="button"
                className={`${btn} mt-2`}
                disabled={busy}
                onClick={async () => {
                  if (await run({ op: "member_add_external", fullName: extName, mobile: extMobile, note: extNote }, `${extName.trim()} added to the team — give them a phone code`)) {
                    setExtName("");
                    setExtMobile("");
                    setExtNote("");
                  }
                }}
              >
                Add outside surveyor
              </button>
              {view.savedExternals.length > 0 ? (
                <div className="mt-3 border-t border-[rgba(32,48,80,0.08)] pt-2 text-[12px]">
                  <p className="mb-1 text-[var(--muted)]">Saved earlier, not on the team:</p>
                  {view.savedExternals.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-2 py-1">
                      <span>
                        {e.fullName} · {e.mobile}
                      </span>
                      <button
                        type="button"
                        className="underline"
                        disabled={busy}
                        onClick={() =>
                          void run({ op: "member_add_external", fullName: e.fullName, mobile: e.mobile, note: e.note, externalId: e.id }, `${e.fullName} added to the team`)
                        }
                      >
                        Add to team
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {view && members.length === 0 ? (
          <p className="text-[12px] text-[var(--muted)]">No survey team yet{canEdit ? " — add staff or an outside surveyor above." : "."}</p>
        ) : null}
        {members.length > 0 ? (
          <ErpTable>
            <ErpTableHead>
              <tr>
                <th className="px-2 py-2 text-left">Name</th>
                <th className="px-2 py-2 text-left">Role</th>
                <th className="px-2 py-2 text-left">App</th>
                <th className="px-2 py-2 text-left">Day starts</th>
                <th className="px-2 py-2 text-left">Beats</th>
                <th className="px-2 py-2 text-left">Phone</th>
                <th className="px-2 py-2 text-left">Actions</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {members.map((m) => {
                const phone = view?.phones[surveyMemberKey(m)];
                return (
                  <tr key={m.id} data-testid={`survey-member-${m.id}`}>
                    <td className="px-2 py-2 text-[12px]">
                      <span className="font-medium text-[var(--brand-deep)]">{m.fullName}</span>
                      <div className="text-[10px] text-[var(--muted)]">
                        {m.kind === "staff" ? `${m.empCode || "Staff"}` : "Outside surveyor"} · {m.mobile || "—"}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-[11px]">{m.role === "leader" ? <b>Team leader</b> : "Surveyor"}</td>
                    <td className="px-2 py-2 text-[11px]">{m.assigned ? <span className="font-semibold text-[var(--tone-green-ink,#166534)]">Can start</span> : <span className="text-[var(--muted)]">Paused</span>}</td>
                    <td className="px-2 py-2 text-[11px]">{m.startMode === "school" ? "At school (gate code)" : "In the field (GPS)"}</td>
                    <td className="px-2 py-2 text-[11px]">{m.beatIds.length ? m.beatIds.map(beatName).join(", ") : "Any beat"}</td>
                    <td className="px-2 py-2 text-[11px]">
                      {phone ? <span>{phone}</span> : <span className="text-[var(--danger,#b91c1c)]">Not registered</span>}
                      {canEdit ? (
                        <button type="button" className="ml-2 underline" onClick={() => void pair(m)}>
                          {phone ? "New phone code" : "Get phone code"}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      {canEdit ? (
                        <RowActionMenu
                          row={m}
                          label={`Actions for ${m.fullName}`}
                          actions={[
                            {
                              id: "assign",
                              label: m.assigned ? "Pause (cannot start)" : "Allow to start",
                              onSelect: (x: SurveyMemberRow) =>
                                void run({ op: "member_update", id: x.id, base: x.revision, assigned: !x.assigned }, x.assigned ? `${x.fullName} paused` : `${x.fullName} can start a survey day`),
                            },
                            {
                              id: "start_mode",
                              label: m.startMode === "school" ? "Starts in the field instead" : "Starts at school instead",
                              onSelect: (x: SurveyMemberRow) =>
                                void run(
                                  { op: "member_update", id: x.id, base: x.revision, startMode: x.startMode === "school" ? "field" : "school" },
                                  `${x.fullName} now starts ${x.startMode === "school" ? "in the field" : "at school with the gate code"}`,
                                ),
                            },
                            {
                              id: "leader",
                              label: "Make team leader",
                              hidden: (x: SurveyMemberRow) => x.role === "leader",
                              onSelect: (x: SurveyMemberRow) => void run({ op: "member_leader", id: x.id, base: x.revision }, `${x.fullName} is team leader`),
                            },
                            {
                              id: "remove",
                              label: "Remove from team",
                              tone: "danger",
                              separatorAbove: true,
                              onSelect: (x: SurveyMemberRow) => {
                                if (window.confirm(`Remove ${x.fullName} from the survey team?`)) {
                                  void run({ op: "member_remove", id: x.id, base: x.revision }, `${x.fullName} removed from the team`);
                                }
                              },
                            },
                          ]}
                        />
                      ) : (
                        "—"
                      )}
                      {canEdit && beats.some((b) => b.isActive) ? (
                        <BeatPicker member={m} beats={beats} busy={busy} onSave={(ids) => run({ op: "member_update", id: m.id, base: m.revision, beatIds: ids }, `${m.fullName}'s beats saved`)} />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </ErpTableBody>
          </ErpTable>
        ) : null}
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          A surveyor&apos;s phone must be registered once: school staff by punching IN at the gate from the staff app, or anyone with a
          phone code from here. The team leader can add or remove staff and beats from the app.
        </p>
      </div>
    </MastersWorkCard>
  );
}

function BeatPicker({ member, beats, busy, onSave }: { member: SurveyMemberRow; beats: SurveyBeatRow[]; busy: boolean; onSave: (ids: string[]) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(member.beatIds);
  if (!open) {
    return (
      <button type="button" className="mt-1 block text-[10px] underline" onClick={() => { setSel(member.beatIds); setOpen(true); }}>
        Beats…
      </button>
    );
  }
  return (
    <div className="mt-1 rounded-lg border border-[rgba(32,48,80,0.15)] p-2 text-[11px]">
      {beats.filter((b) => b.isActive || sel.includes(b.id)).map((b) => (
        <label key={b.id} className="flex items-center gap-1">
          <input type="checkbox" checked={sel.includes(b.id)} onChange={(e) => setSel(e.target.checked ? [...sel, b.id] : sel.filter((x) => x !== b.id))} />
          {b.name}
        </label>
      ))}
      <div className="mt-1 flex gap-2">
        <button type="button" className="font-semibold underline" disabled={busy} onClick={async () => { if (await onSave(sel)) setOpen(false); }}>
          Save
        </button>
        <button type="button" className="underline" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <p className="text-[var(--muted)]">None ticked = any active beat.</p>
    </div>
  );
}

/** Beat / cluster master: add, edit, retire / reactivate — through the write kernel. */
export function SurveyBeatsCard({ progress }: { progress?: (beatId: string) => { captured: number; target: number } }) {
  const query = useSurveyTeam();
  const { run, busy, notice } = useTeamWriter();
  const [edit, setEdit] = useState<SurveyBeatRow | null>(null);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [target, setTarget] = useState("50");
  const view = query.data;
  const canEdit = view?.canEdit ?? false;
  const beats = view?.beats ?? [];

  function reset() {
    setEdit(null);
    setName("");
    setArea("");
    setTarget("50");
  }

  return (
    <MastersWorkCard title="Beat / cluster master" hint="Areas + household targets · the team leader can also edit these from the app">
      <div data-testid="survey-beats-card">
        {query.isError && !view ? <QueryError what="the survey team" error={query.error} retry={() => query.refetch()} /> : null}
        <Notice notice={notice} />
        {canEdit ? (
          <div className="mb-3 grid gap-2 sm:grid-cols-4">
            <input className={inp} placeholder="Beat name *" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={inp} placeholder="Area / cluster" value={area} onChange={(e) => setArea(e.target.value)} />
            <input className={inp} type="number" min={0} placeholder="Target HH" value={target} onChange={(e) => setTarget(e.target.value)} />
            <div className="flex gap-2">
              <button
                type="button"
                className={btn}
                disabled={busy || name.trim().length < 2}
                onClick={async () => {
                  const op: SurveyTeamOp = edit
                    ? { op: "beat_save", id: edit.id, base: edit.revision, name, area, targetHouseholds: Number(target) || 0 }
                    : { op: "beat_save", name, area, targetHouseholds: Number(target) || 0 };
                  if (await run(op, edit ? `Beat updated: ${name.trim()}` : `Beat added: ${name.trim()}`)) reset();
                }}
              >
                {edit ? "Update beat" : "Add beat"}
              </button>
              {edit ? (
                <button type="button" className="text-[12px] underline" onClick={reset}>
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {view && beats.length === 0 ? <p className="text-[12px] text-[var(--muted)]">No beats yet.</p> : null}
        <div className="flex flex-wrap gap-2">
          {beats.map((b) => {
            const p = progress?.(b.id);
            return (
              <div key={b.id} className="flex items-center gap-1" data-testid={`survey-beat-${b.id}`}>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    b.isActive ? "bg-[rgba(180,83,9,0.12)] text-[var(--tone-brick-ink,#9a3412)]" : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)] line-through"
                  }`}
                  title={b.area || ""}
                >
                  {b.code} {b.name}
                  {p ? ` · ${p.captured}/${b.targetHouseholds || "—"}` : b.targetHouseholds ? ` · target ${b.targetHouseholds}` : ""}
                </span>
                {canEdit ? (
                  <>
                    <button
                      type="button"
                      className="text-[10px] text-[var(--muted)] underline"
                      onClick={() => {
                        setEdit(b);
                        setName(b.name);
                        setArea(b.area);
                        setTarget(String(b.targetHouseholds));
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-[10px] text-[var(--muted)] underline"
                      disabled={busy}
                      onClick={() => void run({ op: "beat_active", id: b.id, base: b.revision, isActive: !b.isActive }, b.isActive ? `Retired ${b.name}` : `Reactivated ${b.name}`)}
                    >
                      {b.isActive ? "Retire" : "Reactivate"}
                    </button>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </MastersWorkCard>
  );
}
