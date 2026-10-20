"use client";

/**
 * Learning games — the teacher's and the office's desk (director, 15 Oct 2026).
 *
 * Competitions: launch a quiz or a number-dash competition between sections
 * (a teacher: only their own sections — the server checks each one), and
 * watch the leaderboard fill while it runs (polled every 5 s).
 * Question pool: what the children of a class can be asked — the
 * publisher's keyed questions from the imported papers, AI drafts from a
 * chapter of the class's own book (pending until a teacher approves them),
 * and a teacher's own questions.
 * Limits: the daily allowance, school hours and the evening cut-off. Read by
 * everyone, changed by the principal / office; enforced by the server.
 *
 * Every read and write goes through /api/v1/staff/games/*. Nothing here is
 * kept in the browser beyond React Query's cache.
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy, RefreshCw, Rocket, CheckCircle2, XCircle, Sparkles, FileDown, Plus, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { field } from "@/components/ui/erp-ui";
import { useErpQuery, useMasters } from "@/lib/data/client/hooks";
import { readView } from "@/lib/data/client/query";
import { erpFetch } from "@/lib/data/erpFetch";
import { useMyTeaching } from "@/components/staff/useMyTeaching";
import { refusalText, type GameSettings } from "@/lib/learningGames";

type GamesTab = "competitions" | "pool" | "limits";

const GAMES_TABS: { id: GamesTab; label: string }[] = [
  { id: "competitions", label: "Competitions" },
  { id: "pool", label: "Question pool" },
  { id: "limits", label: "Play limits" },
];

type SectionOpt = { classId: string; sectionId: string; label: string };

type Competition = {
  id: string;
  title: string;
  game: "quiz" | "maths_speed";
  sections: SectionOpt[];
  subjectLabel: string;
  chapterPosition: number | null;
  questionCount: number;
  opensAt: string;
  closesAt: string;
  phase: "upcoming" | "open" | "closed" | "cancelled";
  createdByName: string;
  createdByStaffId?: string;
};

type Detail = {
  competition: Competition;
  playing: number;
  finished: number;
  sections: { sectionId: string; label: string; players: number; correct: number; stars: number; averageCorrect: number }[];
  players: { name: string; classLabel: string; correct: number; stars: number; seconds: number }[];
};

type PoolQuestion = {
  id: string;
  subjectKey: string;
  subjectLabel: string;
  chapterName: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  source: "publisher_key" | "ai" | "teacher";
  review: "approved" | "pending" | "rejected";
  batchId: string;
  createdBy: string;
  createdAt: string;
};

type Pool = {
  grade: number;
  className: string;
  books: { textbookId: string; subjectKey: string; subjectLabel: string; name: string; chapters: { position: number; name: string }[] }[];
  counts: { subjectKey: string; label: string; approved: number; pending: number; rejected: number }[];
  questions: PoolQuestion[];
};

const SUBJECTS: { key: string; label: string }[] = [
  { key: "maths", label: "Mathematics" },
  { key: "english", label: "English" },
  { key: "hindi", label: "Hindi" },
  { key: "science", label: "Science" },
  { key: "evs", label: "EVS" },
  { key: "social", label: "Social Science" },
  { key: "sanskrit", label: "Sanskrit" },
  { key: "gk", label: "General Knowledge" },
  { key: "computer", label: "Computer" },
];

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await erpFetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: { message?: string } };
  if (!res.ok || !j.ok) throw new Error(j.error?.message || `Request failed (${res.status})`);
  return j.data as T;
}

function when(isoText: string): string {
  return new Date(isoText).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

const PHASE_TONE: Record<Competition["phase"], "default" | "secondary" | "outline" | "destructive"> = {
  open: "default",
  upcoming: "secondary",
  closed: "outline",
  cancelled: "destructive",
};

export function GamesWorkspace() {
  const [tab, setTab] = useState<GamesTab>("competitions");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { my, loading: myLoading } = useMyTeaching();
  const masters = useMasters({ enabled: !!my?.unrestricted });

  // The sections this person may launch for: their own, or the whole school.
  const sections: SectionOpt[] = useMemo(() => {
    if (!my) return [];
    if (!my.unrestricted) {
      return my.teaching.map((t) => ({ classId: t.classId, sectionId: t.sectionId, label: `${t.className}-${t.sectionName}` }));
    }
    const m = masters.data?.masters;
    if (!m) return [];
    const order = new Map(m.classes.map((c, i) => [c.id, c.sortOrder ?? i]));
    return m.sections
      .filter((s) => s.isActive !== false)
      .map((s) => ({ classId: s.classId, sectionId: s.id, label: `${m.classes.find((c) => c.id === s.classId)?.name ?? "?"}-${s.name}` }))
      .sort((a, b) => (order.get(a.classId) ?? 0) - (order.get(b.classId) ?? 0) || a.label.localeCompare(b.label));
  }, [my, masters.data]);

  const classes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sections) if (!seen.has(s.classId)) seen.set(s.classId, s.label.replace(/-[^-]*$/, ""));
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [sections]);

  const say = (n: string) => {
    setError(null);
    setNotice(n);
  };
  const fail = (e: unknown) => {
    setNotice(null);
    setError(e instanceof Error ? e.message : String(e));
  };

  return (
    <ErpWorkspaceShell
      title="Learning games"
      subtitle="Practice from the class's own books, number dash, and competitions between sections — stars for learning, limits kept by the server."
      icon={<Trophy className="size-5" aria-hidden />}
      notice={notice}
      error={error}
    >
      <ModuleTabs items={GAMES_TABS} value={tab} onChange={(id) => setTab(id as GamesTab)} aria-label="Games" />
      {myLoading ? <p className="text-sm text-muted-foreground">Loading your classes…</p> : null}
      {!myLoading && !my ? <p className="text-sm text-[var(--danger)]">Could not load your classes — reload to try again.</p> : null}
      {my && !my.unrestricted && sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">You have no classes yet — the office assigns them under Staff → Duties.</p>
      ) : null}
      {tab === "competitions" && my ? <CompetitionsPanel sections={sections} classes={classes} onNotice={say} onError={fail} /> : null}
      {tab === "pool" && my ? <PoolPanel classes={classes} onNotice={say} onError={fail} /> : null}
      {tab === "limits" ? <LimitsPanel onNotice={say} onError={fail} /> : null}
    </ErpWorkspaceShell>
  );
}

// ── Competitions ──────────────────────────────────────────────────────────

function CompetitionsPanel({
  sections,
  classes,
  onNotice,
  onError,
}: {
  sections: SectionOpt[];
  classes: { id: string; name: string }[];
  onNotice: (n: string) => void;
  onError: (e: unknown) => void;
}) {
  const qc = useQueryClient();
  const list = useErpQuery<{ competitions: Competition[] }>("games-competitions", "/api/v1/staff/games/competitions");
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <LaunchForm
        sections={sections}
        classes={classes}
        onLaunched={(c) => {
          onNotice(`Launched “${c.title}” — it is on the children's Games screen now.`);
          setOpen(c.id);
          void qc.invalidateQueries({ queryKey: ["games-competitions"] });
        }}
        onError={onError}
      />
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Competitions (last 30 days)</h2>
          <Button variant="ghost" size="sm" onClick={() => void list.refetch()} aria-label="Refresh competitions">
            <RefreshCw className="size-4" aria-hidden />
          </Button>
        </div>
        {list.isPending ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {list.error ? <p className="text-sm text-[var(--danger)]">Could not load the competitions: {list.error.message}</p> : null}
        {list.data && list.data.competitions.length === 0 ? <p className="text-sm text-muted-foreground">No competitions yet — launch one above.</p> : null}
        <ul className="space-y-3">
          {(list.data?.competitions ?? []).map((c) => (
            <li key={c.id} className="rounded-xl border border-border bg-card p-3" data-testid="games-competition">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{c.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.game === "quiz" ? `Quiz · ${c.subjectLabel}${c.chapterPosition !== null ? ` · Ch ${c.chapterPosition}` : ""} · ${c.questionCount} questions` : "Number dash · 60 s"}
                    {" · "}
                    {c.sections.map((s) => s.label).join(" vs ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {when(c.opensAt)} – {when(c.closesAt)} · by {c.createdByName || "staff"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={PHASE_TONE[c.phase]}>{c.phase}</Badge>
                  <Button size="sm" variant="outline" onClick={() => setOpen(open === c.id ? null : c.id)}>
                    {open === c.id ? "Hide" : "Leaderboard"}
                  </Button>
                </div>
              </div>
              {open === c.id ? (
                <Leaderboard
                  id={c.id}
                  onCancelled={() => {
                    onNotice("Competition cancelled.");
                    void qc.invalidateQueries({ queryKey: ["games-competitions"] });
                  }}
                  onError={onError}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function LaunchForm({
  sections,
  classes,
  onLaunched,
  onError,
}: {
  sections: SectionOpt[];
  classes: { id: string; name: string }[];
  onLaunched: (c: Competition) => void;
  onError: (e: unknown) => void;
}) {
  const [game, setGame] = useState<"quiz" | "maths_speed">("quiz");
  const [picked, setPicked] = useState<string[]>([]);
  const [qClass, setQClass] = useState("");
  const [subjectKey, setSubjectKey] = useState("");
  const [chapter, setChapter] = useState("");
  const [count, setCount] = useState(10);
  const [startAt, setStartAt] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const chosen = sections.filter((s) => picked.includes(s.sectionId));
  const chosenClasses = classes.filter((c) => chosen.some((s) => s.classId === c.id));
  const sourceClass = chosenClasses.find((c) => c.id === qClass)?.id ?? chosenClasses[0]?.id ?? "";
  const pool = useErpQuery<Pool>(["games-pool", sourceClass, "approved"], `/api/v1/staff/games/pool?classId=${encodeURIComponent(sourceClass)}&review=approved`, {
    enabled: game === "quiz" && !!sourceClass,
  });
  const subjects = (pool.data?.counts ?? []).filter((c) => c.approved >= 3);
  const chapters = (pool.data?.books ?? []).filter((b) => b.subjectKey === subjectKey);

  const launch = async () => {
    setBusy(true);
    try {
      const [textbookId, pos] = chapter ? chapter.split("#") : ["", ""];
      const d = await post<{ competition: Competition }>("/api/v1/staff/games/competitions", {
        op: "create",
        game,
        title,
        sections: chosen.map((s) => ({ classId: s.classId, sectionId: s.sectionId })),
        questionClassId: sourceClass,
        subjectKey,
        textbookId,
        chapterPosition: pos === "" ? null : Number(pos),
        questionCount: count,
        opensAt: startAt ? new Date(startAt).toISOString() : undefined,
        durationMinutes: minutes,
      });
      onLaunched(d.competition);
      setPicked([]);
      setTitle("");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Launch a competition">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Rocket className="size-4" aria-hidden /> Launch a competition
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Game</span>
          <select className={field} value={game} onChange={(e) => setGame(e.target.value as "quiz" | "maths_speed")} aria-label="Game">
            <option value="quiz">Syllabus quiz</option>
            <option value="maths_speed">Number dash (60 seconds)</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Title (optional)</span>
          <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Friday maths challenge" aria-label="Title" />
        </label>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Sections competing (two or more)</legend>
        <div className="flex flex-wrap gap-2">
          {sections.map((s) => (
            <label key={s.sectionId} className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-sm">
              <input
                type="checkbox"
                checked={picked.includes(s.sectionId)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.sectionId] : p.filter((x) => x !== s.sectionId)))}
                aria-label={`Section ${s.label}`}
              />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      {game === "quiz" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Questions from class</span>
            <select className={field} value={sourceClass} onChange={(e) => setQClass(e.target.value)} aria-label="Questions from class" disabled={!chosenClasses.length}>
              {chosenClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Subject</span>
            <select className={field} value={subjectKey} onChange={(e) => { setSubjectKey(e.target.value); setChapter(""); }} aria-label="Subject">
              <option value="">{pool.isFetching ? "Loading…" : subjects.length ? "Choose…" : "No approved questions yet"}</option>
              {subjects.map((s) => (
                <option key={s.subjectKey} value={s.subjectKey}>
                  {s.label} ({s.approved})
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Chapter (optional)</span>
            <select className={field} value={chapter} onChange={(e) => setChapter(e.target.value)} aria-label="Chapter">
              <option value="">Whole subject</option>
              {chapters.flatMap((b) =>
                b.chapters.map((c) => (
                  <option key={`${b.textbookId}#${c.position}`} value={`${b.textbookId}#${c.position}`}>
                    {c.position}. {c.name}
                  </option>
                )),
              )}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Questions</span>
            <input className={field} type="number" min={3} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Number of questions" />
          </label>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Starts</span>
          <input className={field} type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} aria-label="Starts" />
          <span className="text-xs text-muted-foreground">Leave empty to start now. School hours are fine for a competition; 9 pm still ends play. It must end the same day.</span>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Runs for (minutes)</span>
          <input className={field} type="number" min={5} max={60} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Runs for minutes" />
          <span className="text-xs text-muted-foreground">5 to 60 minutes. Sections must be in the same or the next band (pre-primary, I–II, III–V, VI–VIII, IX–X, XI–XII).</span>
        </label>
      </div>
      <Button onClick={() => void launch()} disabled={busy || chosen.length < 2 || (game === "quiz" && !subjectKey)}>
        <Rocket className="size-4" aria-hidden /> {busy ? "Launching…" : "Launch competition"}
      </Button>
    </section>
  );
}

function Leaderboard({ id, onCancelled, onError }: { id: string; onCancelled: () => void; onError: (e: unknown) => void }) {
  const q = useQuery({
    queryKey: ["games-competition", id],
    queryFn: async () => {
      const r = await readView<Detail>(`/api/v1/staff/games/competitions/${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    // Live while it runs; a closed competition does not change.
    refetchInterval: (query) => ((query.state.data as Detail | undefined)?.competition.phase === "open" ? 5_000 : false),
  });
  const d = q.data;
  if (q.isPending) return <p className="mt-3 text-sm text-muted-foreground">Loading the leaderboard…</p>;
  if (q.error || !d) return <p className="mt-3 text-sm text-[var(--danger)]">Could not load the leaderboard: {q.error?.message}</p>;
  return (
    <div className="mt-3 space-y-3" data-testid="games-leaderboard">
      <p className="text-xs text-muted-foreground">
        {d.finished} finished · {d.playing} playing now{d.competition.phase === "open" ? " · updates every 5 s" : ""}
      </p>
      <ol className="space-y-1">
        {d.sections.map((s, i) => (
          <li key={s.sectionId} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm" data-testid="games-section-standing">
            <span className="font-medium">
              {i + 1}. {s.label}
            </span>
            <span className="text-muted-foreground">
              {s.averageCorrect} right per player · {s.players} played · ⭐ {s.stars}
            </span>
          </li>
        ))}
      </ol>
      {d.players.length ? (
        <div>
          <p className="text-sm font-medium">Top players</p>
          <ol className="text-sm">
            {d.players.map((p, i) => (
              <li key={`${p.name}-${p.classLabel}-${i}`} className="flex justify-between border-b border-border/50 py-1" data-testid="games-player-standing">
                <span>
                  {i + 1}. {p.name} <span className="text-muted-foreground">({p.classLabel})</span>
                </span>
                <span>
                  {p.correct} right · ⭐ {p.stars} · {p.seconds}s
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nobody has finished yet.</p>
      )}
      {d.competition.phase === "open" || d.competition.phase === "upcoming" ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              await post("/api/v1/staff/games/competitions", { op: "cancel", id });
              await q.refetch();
              onCancelled();
            } catch (e) {
              onError(e);
            }
          }}
        >
          <Ban className="size-4" aria-hidden /> Cancel competition
        </Button>
      ) : null}
    </div>
  );
}

// ── Question pool ──────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<PoolQuestion["source"], string> = {
  publisher_key: "Publisher's key",
  ai: "AI draft",
  teacher: "Teacher",
};

function PoolPanel({ classes, onNotice, onError }: { classes: { id: string; name: string }[]; onNotice: (n: string) => void; onError: (e: unknown) => void }) {
  const qc = useQueryClient();
  const [classId, setClassId] = useState("");
  const [review, setReview] = useState<"pending" | "approved" | "rejected">("pending");
  const [busy, setBusy] = useState("");
  const cls = classId || classes[0]?.id || "";
  const pool = useErpQuery<Pool>(["games-pool", cls, review], `/api/v1/staff/games/pool?classId=${encodeURIComponent(cls)}&review=${review}`, { enabled: !!cls });
  const [chapter, setChapter] = useState("");
  const [draft, setDraft] = useState({ subjectKey: "maths", prompt: "", options: ["", "", "", ""], answerIndex: 0 });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["games-pool"] });
  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      onNotice(await fn());
      refresh();
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Class</span>
          <select className={field} value={cls} onChange={(e) => setClassId(e.target.value)} aria-label="Pool class">
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          disabled={!cls || busy !== ""}
          onClick={() =>
            void run("import", async () => {
              const r = await post<{ papers: number; usable: number; added: number; skipped: Record<string, number> }>("/api/v1/staff/games/pool", { op: "import_papers", classId: cls });
              const skipped = Object.entries(r.skipped)
                .map(([k, v]) => `${v} ${k}`)
                .join(", ");
              setReview("pending");
              return `${r.papers} papers: ${r.added} new questions waiting for review below (${r.usable} usable${skipped ? `; left on paper: ${skipped}` : ""}).`;
            })
          }
        >
          <FileDown className="size-4" aria-hidden /> {busy === "import" ? "Reading papers…" : "Bring in the publisher's keyed questions"}
        </Button>
      </div>

      {pool.data ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {pool.data.counts.length === 0 ? <span className="text-muted-foreground">No questions for {pool.data.className} yet.</span> : null}
          {pool.data.counts.map((c) => (
            <span key={c.subjectKey} className="rounded-full border border-border px-2 py-0.5">
              {c.label}: {c.approved} approved · {c.pending} waiting
            </span>
          ))}
        </div>
      ) : null}

      <section className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4" aria-hidden /> Draft questions from a chapter (AI)
        </h3>
        <p className="text-xs text-muted-foreground">
          Ten questions from the chapter&apos;s name and topics in the class&apos;s own book. They wait here as “pending” — no child sees one until you approve it.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <select className={`${field} max-w-md`} value={chapter} onChange={(e) => setChapter(e.target.value)} aria-label="AI chapter">
            <option value="">{pool.data?.books.length ? "Choose a chapter…" : "No books loaded for this class"}</option>
            {(pool.data?.books ?? []).map((b) => (
              <optgroup key={b.textbookId} label={`${b.subjectLabel} — ${b.name}`}>
                {b.chapters.map((c) => (
                  <option key={c.position} value={`${b.textbookId}#${c.position}`}>
                    {c.position}. {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Button
            disabled={!chapter || busy !== ""}
            onClick={() =>
              void run("ai", async () => {
                const [textbookId, pos] = chapter.split("#");
                const r = await post<{ drafted: number; added: number }>("/api/v1/staff/games/pool", { op: "generate", classId: cls, textbookId, chapterPosition: Number(pos) });
                setReview("pending");
                return r.added ? `${r.added} drafts waiting for your review below.` : `No new drafts (${r.drafted} were already in the pool).`;
              })
            }
          >
            {busy === "ai" ? "Drafting…" : "Draft 10 questions"}
          </Button>
        </div>
      </section>

      <section className="space-y-2 rounded-xl border border-border bg-card p-4" aria-label="Add your own question">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Plus className="size-4" aria-hidden /> Add your own question
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <select className={field} value={draft.subjectKey} onChange={(e) => setDraft({ ...draft, subjectKey: e.target.value })} aria-label="Own question subject">
            {SUBJECTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <input className={field} value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} placeholder="Question" aria-label="Own question text" />
          {draft.options.map((o, i) => (
            <label key={i} className="flex items-center gap-2 text-sm">
              <input type="radio" name="games-right" checked={draft.answerIndex === i} onChange={() => setDraft({ ...draft, answerIndex: i })} aria-label={`Option ${i + 1} is right`} />
              <input
                className={field}
                value={o}
                onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === i ? e.target.value : x)) })}
                placeholder={`Option ${i + 1}${i >= 2 ? " (optional)" : ""}`}
                aria-label={`Own question option ${i + 1}`}
              />
            </label>
          ))}
        </div>
        <Button
          size="sm"
          disabled={!cls || busy !== "" || !draft.prompt.trim()}
          onClick={() =>
            void run("add", async () => {
              const filled = draft.options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
              const answerIndex = filled.findIndex((x) => x.i === draft.answerIndex);
              await post("/api/v1/staff/games/pool", { op: "add", classId: cls, subjectKey: draft.subjectKey, prompt: draft.prompt, options: filled.map((x) => x.o), answerIndex });
              setDraft({ ...draft, prompt: "", options: ["", "", "", ""], answerIndex: 0 });
              return "Question added and approved.";
            })
          }
        >
          Add question
        </Button>
      </section>

      <section className="space-y-2">
        <ModuleTabs
          items={[
            { id: "pending", label: "Waiting for review" },
            { id: "approved", label: "Approved" },
            { id: "rejected", label: "Rejected" },
          ]}
          value={review}
          onChange={(id) => setReview(id as typeof review)}
          aria-label="Review state"
        />
        {pool.isPending && cls ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {pool.error ? <p className="text-sm text-[var(--danger)]">Could not load the pool: {pool.error.message}</p> : null}
        {pool.data && pool.data.questions.length === 0 ? <p className="text-sm text-muted-foreground">Nothing here.</p> : null}
        {review === "pending"
          ? publisherBatches(pool.data?.questions ?? []).map((b) => (
              <div key={`${b.batchId}|${b.subjectKey}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm" data-testid="games-pool-batch">
                <span>
                  {b.count} {b.subjectLabel} question{b.count === 1 ? "" : "s"} from the publisher&apos;s key, imported {new Date(b.createdAt).toLocaleDateString("en-IN")} — read them below, then approve the batch (you can still reject any one first).
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy !== ""}
                  onClick={() =>
                    void run(`batch:${b.batchId}:${b.subjectKey}`, async () => {
                      const r = await post<{ approved: number }>("/api/v1/staff/games/pool", { op: "approve_batch", classId: cls, batchId: b.batchId, subjectKey: b.subjectKey, ids: b.ids });
                      return `${r.approved} approved.`;
                    })
                  }
                >
                  <CheckCircle2 className="size-3.5" aria-hidden /> Approve all {b.count}
                </Button>
              </div>
            ))
          : null}
        <ul className="space-y-2">
          {(pool.data?.questions ?? []).map((q) => (
            <li key={q.id} className="rounded-lg border border-border p-3 text-sm" data-testid="games-pool-question">
              <p className="font-medium">{q.prompt}</p>
              <ol className="mt-1 grid gap-1 sm:grid-cols-2">
                {q.options.map((o, i) => (
                  <li key={i} className={i === q.answerIndex ? "font-semibold text-[var(--success)]" : "text-muted-foreground"}>
                    {String.fromCharCode(97 + i)}) {o} {i === q.answerIndex ? "✓" : ""}
                  </li>
                ))}
              </ol>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {q.subjectLabel}
                  {q.chapterName ? ` · ${q.chapterName}` : ""} · {SOURCE_LABEL[q.source]}
                </span>
                <span className="flex gap-1">
                  {q.review !== "approved" ? (
                    <Button size="xs" variant="outline" disabled={busy !== ""} onClick={() => void run(q.id, async () => (await post("/api/v1/staff/games/pool", { op: "review", id: q.id, review: "approved" }), "Approved."))}>
                      <CheckCircle2 className="size-3.5" aria-hidden /> Approve
                    </Button>
                  ) : null}
                  {q.review !== "rejected" ? (
                    <Button size="xs" variant="ghost" disabled={busy !== ""} onClick={() => void run(q.id, async () => (await post("/api/v1/staff/games/pool", { op: "review", id: q.id, review: "rejected" }), "Rejected — it will not be asked."))}>
                      <XCircle className="size-3.5" aria-hidden /> Reject
                    </Button>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The publisher-keyed questions still waiting, by import batch and subject (the unit "approve all" works on). */
function publisherBatches(questions: PoolQuestion[]): { batchId: string; subjectKey: string; subjectLabel: string; count: number; ids: string[]; createdAt: string }[] {
  const out = new Map<string, { batchId: string; subjectKey: string; subjectLabel: string; count: number; ids: string[]; createdAt: string }>();
  for (const q of questions) {
    if (q.source !== "publisher_key" || q.review !== "pending" || !q.batchId) continue;
    const k = `${q.batchId}|${q.subjectKey}`;
    const b = out.get(k) ?? { batchId: q.batchId, subjectKey: q.subjectKey, subjectLabel: q.subjectLabel, count: 0, ids: [], createdAt: q.createdAt };
    b.count += 1;
    b.ids.push(q.id);
    out.set(k, b);
  }
  return [...out.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.subjectLabel.localeCompare(b.subjectLabel));
}

// ── Limits ─────────────────────────────────────────────────────────────────

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function LimitsPanel({ onNotice, onError }: { onNotice: (n: string) => void; onError: (e: unknown) => void }) {
  const qc = useQueryClient();
  const q = useErpQuery<{ settings: GameSettings & { updatedAt: string | null; updatedBy: string }; canEdit: boolean }>("games-settings", "/api/v1/staff/games/settings");
  const [edit, setEdit] = useState<GameSettings | null>(null);
  const s = edit ?? q.data?.settings ?? null;
  const canEdit = !!q.data?.canEdit;
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error || !s) return <p className="text-sm text-[var(--danger)]">Could not load the limits: {q.error?.message}</p>;
  const set = (patch: Partial<GameSettings>) => setEdit({ ...s, ...patch });
  return (
    <section className="max-w-xl space-y-4 rounded-xl border border-border bg-card p-4" aria-label="Play limits">
      <p className="text-sm text-muted-foreground">
        The server refuses a game outside these limits, whatever the app shows. A competition a teacher launches may be played in school hours and does not stop at the
        daily allowance (its minutes still count); nothing is played after the evening cut-off.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.enabled} disabled={!canEdit} onChange={(e) => set({ enabled: e.target.checked })} aria-label="Games switched on" />
        Games switched on
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Daily play per child (minutes)</span>
          <input className={field} type="number" min={1} max={240} value={s.dailyMinutes} disabled={!canEdit} onChange={(e) => set({ dailyMinutes: Number(e.target.value) })} aria-label="Daily minutes" />
        </label>
        <div />
        <label className="space-y-1 text-sm">
          <span className="font-medium">Play from</span>
          <input className={field} type="time" value={s.playFrom} disabled={!canEdit} onChange={(e) => set({ playFrom: e.target.value })} aria-label="Play from" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Play until (latest 21:00)</span>
          <input className={field} type="time" value={s.playUntil} max="21:00" disabled={!canEdit} onChange={(e) => set({ playUntil: e.target.value })} aria-label="Play until" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">School starts</span>
          <input className={field} type="time" value={s.schoolStart} disabled={!canEdit} onChange={(e) => set({ schoolStart: e.target.value })} aria-label="School starts" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">School ends</span>
          <input className={field} type="time" value={s.schoolEnd} disabled={!canEdit} onChange={(e) => set({ schoolEnd: e.target.value })} aria-label="School ends" />
        </label>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">School days</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={s.schoolDays.includes(i)}
                onChange={(e) => set({ schoolDays: e.target.checked ? [...s.schoolDays, i].sort() : s.schoolDays.filter((x) => x !== i) })}
                aria-label={`School day ${d}`}
              />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-muted-foreground">What a child sees when refused in school hours: “{refusalText("school_hours").en}”</p>
      {canEdit ? (
        <Button
          disabled={!edit}
          onClick={async () => {
            try {
              await post("/api/v1/staff/games/settings", edit);
              setEdit(null);
              await qc.invalidateQueries({ queryKey: ["games-settings"] });
              onNotice("Play limits saved — they apply to the next game started.");
            } catch (e) {
              onError(e);
            }
          }}
        >
          Save limits
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Only the principal or the office can change these.</p>
      )}
    </section>
  );
}
