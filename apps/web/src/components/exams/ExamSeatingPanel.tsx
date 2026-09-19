"use client";
// ratchet-allow: grids_without_row_menu — rooms are edited as inputs and the bench plan is a seating diagram; neither row is a record with actions

/**
 * Seating — the rooms, the plan, and the slips that get pasted on benches.
 *
 * The arithmetic lives in lib/examSeating.ts and is tested against this
 * school's real shape; this screen is the rooms the office types, the button
 * that runs it, and the three things they print.
 *
 * A generated plan is SAVED, not recomputed on each open: a child must find
 * the same bench on every paper of the exam, and the slip on the desk has to
 * match the sheet in the invigilator's hand.
 */

import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { useCallback, useMemo, useState } from "react";
import {
  deleteExamRoom,
  deleteSeatingPlan,
  listExamRooms,
  loadExams,
  saveExamRoom,
  saveSeatingPlan,
  seatingPlanFor,
  type ExamTerm,
} from "@/lib/exams";
import {
  adjacencyBreaches,
  benchSlips,
  buildSeatingPlan,
  groupBreaches,
  missingRollNumbers,
  roomCapacity,
  seatingExportRows,
  type ExamRoom,
  type SeatingStudent,
} from "@/lib/examSeating";
import {
  CLASS_GROUPS,
  classGroupCodeForName,
  type MastersState,
} from "@/lib/masters";
import { childrenOfHousehold, loadSis } from "@/lib/sis";
import {
  downloadExcelCsv,
  downloadPdfReport,
  downloadXlsxReport,
  type ReportColumn,
} from "@/lib/reportExport";
import { useDemoSession } from "@/components/shell/SessionContext";
import { EmptyState } from "@/components/ui/empty-state";

type Props = {
  academicYearCode: string;
  masters: MastersState;
  terms: ExamTerm[];
};

const COLUMNS: ReportColumn[] = [
  { key: "room", header: "Room" },
  { key: "bench", header: "Bench" },
  { key: "seat", header: "Seat" },
  { key: "className", header: "Class" },
  { key: "rollOrAdmission", header: "Roll / Adm no" },
  { key: "studentName", header: "Student" },
];

export function ExamSeatingPanel({ academicYearCode, masters, terms }: Props) {
  const session = useDemoSession();
  const [tick, setTick] = useState(0);
  const [examTermId, setExamTermId] = useState(terms[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Room draft.
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState("");
  const [roomBenches, setRoomBenches] = useState("20");
  const [roomSeats, setRoomSeats] = useState("2");

  const exams = useMemo(() => {
    void tick;
    return loadExams();
  }, [tick]);
  const rooms = useMemo(() => listExamRooms(exams), [exams]);
  const saved = useMemo(
    () => seatingPlanFor(academicYearCode, examTermId, exams),
    [academicYearCode, examTermId, exams],
  );

  function refresh(message?: string) {
    setTick((v) => v + 1);
    setError(null);
    if (message) {
      setNotice(message);
      window.setTimeout(() => setNotice(null), 2600);
    }
  }

  /**
   * The children sitting this exam, by class, each class carrying its group.
   *
   * childrenOfHousehold is the one that counts a child once: the raw
   * `status === "active"` filter returns a row per child per academic year.
   */
  const studentsByClass = useMemo(() => {
    const sis = loadSis();
    const households = new Set(
      sis.students.map((s) => s.householdId).filter(Boolean) as string[],
    );
    const seen = new Map<string, SeatingStudent[]>();
    for (const hh of households) {
      for (const child of childrenOfHousehold(sis, hh, academicYearCode)) {
        const list = seen.get(child.classId) ?? [];
        list.push({
          id: child.id,
          classId: child.classId,
          name: child.fullName,
          rollNo: (child.rollNo || "").trim(),
          admissionNo: child.admissionNo || "",
        });
        seen.set(child.classId, list);
      }
    }
    const groupRank = new Map(CLASS_GROUPS.map((g, i) => [g.code, i]));
    return masters.classes
      .filter((c) => c.isActive !== false && (seen.get(c.id)?.length ?? 0) > 0)
      .map((c) => {
        const code = c.groupCode ?? classGroupCodeForName(c.name);
        const group = CLASS_GROUPS.find((g) => g.code === code);
        return {
          classId: c.id,
          className: c.name,
          groupLabel: group?.label ?? "Other",
          groupRank: groupRank.get(code) ?? 99,
          sortOrder: c.sortOrder,
          students: seen.get(c.id) ?? [],
        };
      })
      // Youngest group first, and classes in their own order within it —
      // the order the hall is filled in, and the order it reads in.
      .sort((a, b) => a.groupRank - b.groupRank || a.sortOrder - b.sortOrder);
  }, [masters, academicYearCode]);

  const plan = useMemo(
    () => buildSeatingPlan({ rooms, studentsByClass }),
    [rooms, studentsByClass],
  );
  const breaches = useMemo(
    () => [...adjacencyBreaches(plan), ...groupBreaches(plan)],
    [plan],
  );
  const noRoll = useMemo(() => missingRollNumbers(plan), [plan]);
  const exportRows = useMemo(() => seatingExportRows(plan), [plan]);

  const term = terms.find((t) => t.id === examTermId);

  function resetRoomDraft() {
    setEditingRoomId(null);
    setRoomName("");
    setRoomBenches("20");
    setRoomSeats("2");
  }

  function submitRoom() {
    const result = saveExamRoom({
      id: editingRoomId ?? undefined,
      name: roomName,
      benches: Number(roomBenches),
      seatsPerBench: Number(roomSeats),
      isActive: true,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    resetRoomDraft();
    refresh(editingRoomId ? "Room updated" : "Room added");
  }

  function editRoom(room: ExamRoom) {
    setEditingRoomId(room.id);
    setRoomName(room.name);
    setRoomBenches(String(room.benches));
    setRoomSeats(String(room.seatsPerBench));
    setError(null);
  }

  function removeRoom(room: ExamRoom) {
    if (!window.confirm(`Remove ${room.name}?`)) return;
    const result = deleteExamRoom(room.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (editingRoomId === room.id) resetRoomDraft();
    refresh("Room removed");
  }

  function saveThisPlan() {
    if (!examTermId) {
      setError("Select an exam first");
      return;
    }
    if (breaches.length > 0) {
      // Refusing here rather than warning: a plan that seats a child beside
      // their own class is the one thing this must never print.
      setError(`This plan breaks the seating rule (${breaches[0]}). Nothing saved.`);
      return;
    }
    const seats = plan.rooms.flatMap((room) =>
      room.benches.flatMap((bench) =>
        bench.seats.flatMap((s, i) =>
          s
            ? [{
                roomId: room.roomId,
                benchNumber: bench.number,
                seatNumber: i + 1,
                studentId: s.studentId,
                classId: s.classId,
              }]
            : [],
        ),
      ),
    );
    const result = saveSeatingPlan({
      academicYearCode,
      examTermId,
      generatedBy: session?.fullName || "",
      seats,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh(`Seating saved — ${seats.length} children`);
  }

  function clearPlan() {
    if (!saved) return;
    if (!window.confirm("Clear the saved seating for this exam?")) return;
    deleteSeatingPlan(saved.id);
    refresh("Saved seating cleared");
  }

  const exportInput = useCallback(
    () => ({
      title: `Seating — ${term?.label ?? "Exam"}`,
      subtitle: `${academicYearCode} · ${exportRows.length} children · ${plan.rooms.length} room(s)`,
      columns: COLUMNS,
      rows: exportRows as unknown as Record<string, string>[],
      fileBaseName: `seating_${(term?.code ?? "exam").toLowerCase()}`,
    }),
    [term, academicYearCode, exportRows, plan.rooms.length],
  );

  return (
    <div className="mt-6 grid gap-6">
      {error ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-[rgba(15,122,76,0.1)] px-3 py-2 text-xs text-[var(--ok)]">
          {notice}
        </p>
      ) : null}

      {/* ── Rooms ── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">Rooms</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Each room has its own number of benches and its own bench size — some
          rooms are two-seaters, some three.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Room name</span>
            <input
              className="field !py-1.5"
              value={roomName}
              placeholder="Hall A"
              onChange={(e) => setRoomName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Benches</span>
            <input
              type="number"
              min={1}
              max={200}
              className="field !py-1.5"
              value={roomBenches}
              onChange={(e) => setRoomBenches(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Students per bench</span>
            <select
              className="field !py-1.5"
              value={roomSeats}
              onChange={(e) => setRoomSeats(e.target.value)}
            >
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-accent rounded-lg px-3 py-2 text-sm font-bold"
              onClick={submitRoom}
            >
              {editingRoomId ? "Save" : "Add room"}
            </button>
            {editingRoomId ? (
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold"
                onClick={resetRoomDraft}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>

        {rooms.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">
            No rooms yet. Add the halls and classrooms the exam is written in.
          </p>
        ) : (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {rooms.map((room) => (
              <li
                key={room.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--brand-deep)]">{room.name}</p>
                  <p className="text-[11px] text-[var(--muted)]">
                    {room.benches} benches × {room.seatsPerBench} = {roomCapacity(room)} seats
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-semibold"
                    onClick={() => editRoom(room)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-semibold text-[var(--danger)]"
                    onClick={() => removeRoom(room)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── The plan ── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">Seating plan</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {plan.toSeat} children · {plan.capacity} seats · no child beside
              their own class, and no bench mixing class groups.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Exam</span>
              <select
                className="field !py-1.5"
                value={examTermId}
                onChange={(e) => setExamTermId(e.target.value)}
              >
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-accent rounded-lg px-3 py-2 text-sm font-bold"
              onClick={saveThisPlan}
              disabled={plan.rooms.length === 0}
            >
              {saved ? "Regenerate & save" : "Save this plan"}
            </button>
            {saved ? (
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--danger)]"
                onClick={clearPlan}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>

        {saved ? (
          <p className="mt-3 text-xs text-[var(--muted)]">
            Saved {new Date(saved.generatedAt).toLocaleString("en-IN")} ·{" "}
            {saved.seats.length} children
            {saved.generatedBy ? ` · by ${saved.generatedBy}` : ""}
          </p>
        ) : null}

        {breaches.length > 0 ? (
          <div className="mt-3 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
            <p className="font-semibold">This plan breaks the seating rule:</p>
            <ul className="mt-1 list-disc pl-4">
              {breaches.slice(0, 5).map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {plan.notes.map((n) => (
          <p
            key={n}
            className="mt-2 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]"
          >
            {n}
          </p>
        ))}

        {plan.unseated.length > 0 ? (
          <div className="mt-3 rounded-lg border border-[var(--border)] p-3">
            <p className="text-xs font-semibold text-[var(--danger)]">
              {plan.unseated.length} children have no seat
            </p>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              {plan.unseated.slice(0, 20).map((u) => `${u.className} · ${u.name}`).join(" · ")}
              {plan.unseated.length > 20 ? " …" : ""}
            </p>
          </div>
        ) : null}

        {noRoll.length > 0 ? (
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            {noRoll.length} children have no roll number — their slip shows the
            admission number: {noRoll.slice(0, 10).map((s) => s.name).join(", ")}
            {noRoll.length > 10 ? " …" : ""}
          </p>
        ) : null}

        {plan.rooms.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nothing to seat yet"
              description="Add rooms above, and make sure this session has students."
            />
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold"
                onClick={() => downloadExcelCsv(exportInput())}
              >
                CSV
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold"
                onClick={() => void downloadXlsxReport(exportInput())}
              >
                Excel
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold"
                onClick={() => void downloadPdfReport(exportInput())}
              >
                PDF
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold"
                onClick={() => window.print()}
              >
                Print bench slips
              </button>
            </div>

            {plan.tallies.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <ErpTableShell><ErpTable minWidth="min-w-[640px]">
                  <ErpTableHead>
                    <tr>
                      {["Class", "Group", "Children", "Seated", "Rooms"].map((h) => (
                        <th
                          key={h}
                          className="border border-[var(--border)] bg-[var(--surface-sunken)] p-2"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </ErpTableHead>
                  <ErpTableBody>
                    {plan.tallies.map((t) => (
                      <tr key={t.classId}>
                        <td className="border border-[var(--border)] p-2 font-semibold">
                          {t.className}
                        </td>
                        <td className="border border-[var(--border)] p-2">{t.groupLabel}</td>
                        <td className="border border-[var(--border)] p-2">{t.total}</td>
                        <td className="border border-[var(--border)] p-2">
                          {t.seated}
                          {t.seated < t.total ? (
                            <span className="ml-1 font-semibold text-[var(--danger)]">
                              ({t.total - t.seated} not seated)
                            </span>
                          ) : null}
                        </td>
                        <td className="border border-[var(--border)] p-2">
                          {t.rooms.join(", ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </ErpTableBody>
                </ErpTable></ErpTableShell>
              </div>
            ) : null}

            {plan.rooms.map((room) => (
              <div key={room.roomId} className="mt-6">
                <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                  {room.roomName}{" "}
                  <span className="font-normal text-[var(--muted)]">
                    · {room.seatsPerBench}-seater ·{" "}
                    {room.bands
                      .map((b) => `${b.groupLabel} benches ${b.fromBench}–${b.toBench}`)
                      .join(", ")}
                  </span>
                </h3>
                <div className="mt-2 overflow-x-auto">
                  <ErpTableShell><ErpTable minWidth="min-w-[640px]">
                    <ErpTableHead>
                      <tr>
                        <th className="border border-[var(--border)] bg-[var(--surface-sunken)] p-2">
                          Bench
                        </th>
                        {Array.from({ length: room.seatsPerBench }, (_, i) => (
                          <th
                            key={i}
                            className="border border-[var(--border)] bg-[var(--surface-sunken)] p-2"
                          >
                            Seat {i + 1}
                          </th>
                        ))}
                      </tr>
                    </ErpTableHead>
                    <ErpTableBody>
                      {room.benches.map((bench) => (
                        <tr key={bench.number}>
                          <td className="border border-[var(--border)] p-2 font-semibold">
                            {bench.number}
                          </td>
                          {bench.seats.map((s, i) => (
                            <td key={i} className="border border-[var(--border)] p-2">
                              {s ? (
                                <>
                                  <div className="font-semibold text-[var(--brand-deep)]">
                                    {s.className} · {s.label}
                                  </div>
                                  <div className="text-[11px] text-[var(--muted)]">{s.name}</div>
                                </>
                              ) : (
                                <span className="text-[var(--muted)]">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </ErpTableBody>
                  </ErpTable></ErpTableShell>
                </div>
              </div>
            ))}

            {/* Bench slips — screen-hidden, and all that prints. */}
            <div className="hidden print:block">
              <div className="grid grid-cols-2 gap-3">
                {benchSlips(plan).map((slip) => (
                  <div
                    key={`${slip.roomName}-${slip.benchNumber}`}
                    className="break-inside-avoid rounded border border-black p-3"
                  >
                    <p className="text-sm font-bold">
                      {slip.roomName} · Bench {slip.benchNumber}
                    </p>
                    {slip.lines.map((l) => (
                      <p key={l} className="text-xs">
                        {l}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
