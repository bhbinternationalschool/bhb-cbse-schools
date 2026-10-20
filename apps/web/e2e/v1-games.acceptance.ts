/**
 * Acceptance check for the learning games (director, 15 Oct 2026) on the
 * local stack — run by `bash scripts/e2e-stack.sh check` with the stack's
 * state dir as argument 1.
 *
 * Every request carries `x-e2e-clock` (honoured only on this stack: E2E=1 and
 * a 127.0.0.1 Supabase URL — lib/learningGames.server gameNow), so the checks
 * stand at 5 pm, 10 am or 9.30 pm on a school Wednesday whatever the runner's
 * own clock says.
 *
 *  1. The score is the server's: a phone is never sent an answer; a forged
 *     "I got 99" in finish is ignored; a question takes one answer; an option
 *     or question that does not exist is refused; nothing counts after the
 *     game's deadline; one family cannot answer another's game.
 *  2. The limits are the server's: practice is refused in school hours, at
 *     night and past the daily allowance; a teacher-launched competition is
 *     played in school hours and past the allowance, but not at night.
 *  3. A competition: a teacher may launch only for sections they teach; the
 *     principal launches III-A vs IV-A; two children play; a second attempt is
 *     refused; the leaderboard ranks the sections and shows first names only;
 *     a family of another section cannot read it.
 *  4. R6: with game_sessions unreadable, status is a 503, not a fresh day.
 * Everything written (game_* rows, the settings row) is removed at the end.
 */

import { buildFixture, AY_CURRENT, classId, sectionId } from "./fixture";
import { arr, cookieFor, localUrl, obj, parentSession, reporter, rest, tenantId, withUnreadableTable, type HttpResult } from "./parentApi.support";
import { sessionCookieHeader } from "./session";

const WED = "2026-10-21"; // a Wednesday
const at = (hhmm: string, plusSeconds = 0) => new Date(Date.parse(`${WED}T${hhmm}:00+05:30`) + plusSeconds * 1000).toISOString();

async function call(app: string, method: "GET" | "POST", path: string, cookie: Record<string, string>, clock: string, body?: unknown): Promise<HttpResult> {
  const t0 = performance.now();
  const res = await fetch(app + path, {
    method,
    headers: { ...cookie, "x-e2e-clock": clock, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { _text: text.slice(0, 200) };
  }
  return { status: res.status, body: parsed, text, ms: performance.now() - t0 };
}

const data = (r: HttpResult) => obj(obj(r.body).data);
const reason = (r: HttpResult) => String(obj(obj(obj(r.body).error).details).reason ?? "");

async function cleanup(tid: string): Promise<void> {
  const db = rest();
  // Answers cascade from sessions; sessions from competitions.
  await db.remove(`game_sessions?tenant_id=eq.${tid}`);
  await db.remove(`game_competitions?tenant_id=eq.${tid}`);
  await db.remove(`game_questions?tenant_id=eq.${tid}`);
  await db.remove(`game_settings?tenant_id=eq.${tid}`);
}

async function main(): Promise<void> {
  const stateDir = process.argv[2] || "";
  if (!stateDir) throw new Error("usage: v1-games.acceptance.ts <e2e state dir>");
  const app = localUrl("E2E_APP_URL", process.env.E2E_APP_URL);
  const r = reporter();
  const fx = buildFixture();
  const tid = await tenantId();
  await cleanup(tid);

  const principal = { cookie: sessionCookieHeader(fx.sessions.principal) };
  const teacher = { cookie: sessionCookieHeader(fx.sessions.teacher) }; // class teacher of Nursery-A only

  const childIn = (k: number) => {
    const s = fx.sis.students.find(
      (x) => x.sectionId === sectionId(k) && x.academicYearCode === AY_CURRENT && x.status === "active" && !/inactive|dupadm/.test(x.householdId),
    );
    if (!s) throw new Error(`no child in section ${k}`);
    return s;
  };
  const kidA = childIn(6); // III-A
  const kidB = childIn(7); // IV-A
  const kidC = childIn(9); // VI-A — not in the competition
  const famA = cookieFor(parentSession(kidA.householdId));
  const famB = cookieFor(parentSession(kidB.householdId));
  const famC = cookieFor(parentSession(kidC.householdId));
  if (kidA.householdId === kidB.householdId) throw new Error("fixture: A and B share a family");

  try {
    // ── Setup: limits and a question pool for Class III ────────────────────
    const tSet = await call(app, "POST", "/api/v1/staff/games/settings", teacher, at("09:00"), { dailyMinutes: 1 });
    r.record("a teacher cannot change the play limits", tSet.status === 403, String(tSet.status));
    const late = await call(app, "POST", "/api/v1/staff/games/settings", principal, at("09:00"), { playUntil: "22:30" });
    r.record("the school cannot move play past 9 pm", late.status === 400, `${late.status} ${late.text.slice(0, 80)}`);
    const pSet = await call(app, "POST", "/api/v1/staff/games/settings", principal, at("09:00"), { dailyMinutes: 30 });
    r.record("the principal sets the daily allowance", pSet.status === 200 && obj(data(pSet).settings).dailyMinutes === 30, String(pSet.status));

    const qs = [
      ["5 + 3 = ?", ["7", "8", "9"], 1],
      ["10 − 4 = ?", ["6", "5", "4"], 0],
      ["2 × 6 = ?", ["10", "14", "12"], 2],
      ["Half of 18?", ["9", "8"], 0],
      ["Which is the biggest?", ["99", "909", "990"], 2],
    ] as const;
    let added = 0;
    for (const [prompt, options, answerIndex] of qs) {
      const a = await call(app, "POST", "/api/v1/staff/games/pool", principal, at("09:00"), {
        op: "add",
        classId: classId(6),
        subjectKey: "maths",
        prompt,
        options,
        answerIndex,
      });
      if (a.status === 200) added += Number(data(a).added);
    }
    r.record("five teacher questions in Class III's maths pool, approved", added === 5, `added ${added}`);
    const tPool = await call(app, "POST", "/api/v1/staff/games/pool", teacher, at("09:00"), { op: "add", classId: classId(6), subjectKey: "maths", prompt: "x?", options: ["a", "b"], answerIndex: 0 });
    r.record("a teacher cannot add to another class's pool", tPool.status === 403, String(tPool.status));

    // ── 3. A competition (morning, in school hours) ───────────────────────
    const pair = [
      { classId: classId(6), sectionId: sectionId(6) },
      { classId: classId(7), sectionId: sectionId(7) },
    ];
    const notMine = await call(app, "POST", "/api/v1/staff/games/competitions", teacher, at("09:55"), { op: "create", game: "maths_speed", sections: pair, durationMinutes: 60 });
    r.record("a teacher cannot launch for sections they do not teach", notMine.status === 403, `${notMine.status} ${notMine.text.slice(0, 80)}`);
    const tooFew = await call(app, "POST", "/api/v1/staff/games/competitions", principal, at("09:55"), { op: "create", game: "quiz", subjectKey: "maths", questionCount: 9, sections: pair, durationMinutes: 60 });
    r.record("a quiz bigger than the approved pool is refused", tooFew.status === 400 && reason(tooFew) === "pool_too_small", `${tooFew.status} ${reason(tooFew)}`);
    const made = await call(app, "POST", "/api/v1/staff/games/competitions", principal, at("09:55"), {
      op: "create",
      game: "quiz",
      title: "III vs IV maths",
      subjectKey: "maths",
      questionClassId: classId(6),
      questionCount: 5,
      sections: pair,
      opensAt: at("10:00"),
      durationMinutes: 60,
    });
    const comp = obj(data(made).competition);
    const cid = String(comp.id ?? "");
    r.record("the principal launches III-A vs IV-A", made.status === 200 && !!cid && comp.phase === "upcoming", `${made.status} ${comp.phase}`);

    const early = await call(app, "POST", "/api/v1/games/start", famA, at("09:58"), { studentId: kidA.id, competitionId: cid });
    r.record("not before it opens", early.status === 403 && reason(early) === "competition_closed", `${early.status} ${reason(early)}`);
    const seen = await call(app, "GET", `/api/v1/games/status?studentId=${kidA.id}`, famA, at("10:01"));
    r.record("the competition is on III-A's Games screen", arr(data(seen).competitions).some((c) => obj(c).id === cid && obj(c).phase === "open"), JSON.stringify(data(seen).competitions).slice(0, 120));
    const notSeen = await call(app, "GET", `/api/v1/games/status?studentId=${kidC.id}`, famC, at("10:01"));
    r.record("and not on VI-A's", !arr(data(notSeen).competitions).some((c) => obj(c).id === cid), String(notSeen.status));

    const playComp = async (fam: Record<string, string>, kid: string, rightCount: number, clock: string) => {
      const s = await call(app, "POST", "/api/v1/games/start", fam, clock, { studentId: kid, competitionId: cid });
      const id = String(data(s).sessionId ?? "");
      if (s.status !== 200) return { start: s, finish: null as HttpResult | null, firstAnswer: null as HttpResult | null };
      const rowC = (await rest().select(`game_sessions?id=eq.${id}&select=items`)) as { items: { answer: number; options: string[] }[] }[];
      let firstAnswer: HttpResult | null = null;
      for (let i = 0; i < rowC[0]!.items.length; i++) {
        const it = rowC[0]!.items[i]!;
        const a = await call(app, "POST", "/api/v1/games/answer", fam, clock, { sessionId: id, index: i, choice: i < rightCount ? it.answer : (it.answer + 1) % it.options.length });
        firstAnswer ??= a;
      }
      return { start: s, firstAnswer, finish: await call(app, "POST", "/api/v1/games/finish", fam, clock, { sessionId: id, correct: 5 }) };
    };
    // It is school time: practice is refused, a competition still plays.
    const pa = await playComp(famA, kidA.id, 4, at("10:05"));
    r.record("a competition plays in school hours", pa.start.status === 200, `${pa.start.status} ${reason(pa.start)}`);
    r.record("in a competition the right option is not revealed per question", pa.firstAnswer?.status === 200 && obj(obj(pa.firstAnswer.body).data).correctIndex === null, pa.firstAnswer?.text.slice(0, 100) ?? "");
    r.record("A: 4 right of 5", !!pa.finish && data(pa.finish).correct === 4 && data(pa.finish).stars === 4, pa.finish?.text.slice(0, 100) ?? "");
    const pb = await playComp(famB, kidB.id, 2, at("10:10"));
    r.record("B: 2 right of 5", !!pb.finish && data(pb.finish).correct === 2, pb.finish?.text.slice(0, 100) ?? "");
    const twice = await call(app, "POST", "/api/v1/games/start", famA, at("10:20"), { studentId: kidA.id, competitionId: cid });
    r.record("one attempt per child", twice.status === 409 && reason(twice) === "already_played", `${twice.status} ${reason(twice)}`);
    const outsider = await call(app, "POST", "/api/v1/games/start", famC, at("10:20"), { studentId: kidC.id, competitionId: cid });
    r.record("a child of another section cannot join", outsider.status === 404, String(outsider.status));

    const board = await call(app, "GET", `/api/v1/staff/games/competitions/${cid}`, principal, at("10:30"));
    const secs = arr(data(board).sections).map((s) => [obj(s).label, obj(s).averageCorrect, obj(s).players]);
    const players = arr(data(board).players).map((p) => obj(p));
    r.record("the leaderboard ranks III-A (4) over IV-A (2)", JSON.stringify(secs) === JSON.stringify([["III-A", 4, 1], ["IV-A", 2, 1]]), JSON.stringify(secs));
    r.record(
      "players by first name and class only",
      players.length === 2 &&
        players[0]!.name === kidA.fullName.split(" ")[0] &&
        players.every((p) => !String(p.name).includes(" ") && Object.keys(p).sort().join() === "classLabel,correct,name,seconds,stars"),
      JSON.stringify(players),
    );
    const parentBoard = await call(app, "GET", `/api/v1/games/leaderboard?studentId=${kidB.id}&competitionId=${cid}`, famB, at("10:30"));
    r.record("a competing family sees the same leaderboard", parentBoard.status === 200 && arr(data(parentBoard).sections).length === 2 && !parentBoard.text.includes(kidA.fullName) && !parentBoard.text.includes("createdByStaffId"), `${parentBoard.status}`);
    const otherBoard = await call(app, "GET", `/api/v1/games/leaderboard?studentId=${kidC.id}&competitionId=${cid}`, famC, at("10:30"));
    r.record("another section's family cannot", otherBoard.status === 404, String(otherBoard.status));
    // ── 2. The limits are the server's ────────────────────────────────────
    const school = await call(app, "POST", "/api/v1/games/start", famA, at("10:00"), { studentId: kidA.id, game: "maths_speed" });
    r.record("practice refused in school hours", school.status === 403 && reason(school) === "school_hours", `${school.status} ${reason(school)}`);
    // ── 1. The score is the server's ──────────────────────────────────────
    const st = await call(app, "GET", `/api/v1/games/status?studentId=${kidA.id}`, famA, at("17:00"));
    const lim = obj(data(st).limits);
    const subjects = arr(obj(data(st).pool).subjects).map((s) => String(obj(s).subjectKey));
    r.record("after school: practice open, 30 min left, maths in the pool", st.status === 200 && lim.canPracticeNow === true && lim.leftSeconds === 1800 && subjects.includes("maths"), `${st.status} ${JSON.stringify(lim).slice(0, 120)} ${subjects}`);

    const other = await call(app, "GET", `/api/v1/games/status?studentId=${kidB.id}`, famA, at("17:00"));
    r.record("a family cannot open another family's child", other.status === 404, String(other.status));

    const start = await call(app, "POST", "/api/v1/games/start", famA, at("17:00"), { studentId: kidA.id, game: "quiz", subjectKey: "maths" });
    const sid = String(data(start).sessionId ?? "");
    const items = arr(data(start).items);
    r.record("a quiz starts with the pool's five questions", start.status === 200 && items.length === 5, `${start.status} ${items.length}`);
    r.record("no answer is sent to the phone", items.every((it) => !("answer" in obj(it))) && !start.text.includes('"answer"'), start.text.slice(0, 120));

    // The test reads the right answers where only the server can — the stack's database.
    const row = (await rest().select(`game_sessions?id=eq.${sid}&select=items`)) as { items: { answer: number }[] }[];
    const answers = row[0]!.items.map((it) => it.answer);
    // Right on the first three, wrong on the fourth, the fifth left unanswered.
    for (let i = 0; i < 4; i++) {
      const choice = i < 3 ? answers[i]! : (answers[i]! + 1) % arr(obj(items[i]).options).length;
      await call(app, "POST", "/api/v1/games/answer", famA, at("17:00", 10 + i * 10), { sessionId: sid, index: i, choice });
    }
    const again = await call(app, "POST", "/api/v1/games/answer", famA, at("17:01"), { sessionId: sid, index: 0, choice: answers[0] });
    r.record("a question takes one answer", again.status === 409 && reason(again) === "answered", `${again.status} ${reason(again)}`);
    const badChoice = await call(app, "POST", "/api/v1/games/answer", famA, at("17:01"), { sessionId: sid, index: 4, choice: 9 });
    const badIndex = await call(app, "POST", "/api/v1/games/answer", famA, at("17:01"), { sessionId: sid, index: 99, choice: 0 });
    r.record("an option or question that does not exist is refused", badChoice.status === 400 && badIndex.status === 400, `${badChoice.status} ${badIndex.status}`);
    const stranger = await call(app, "POST", "/api/v1/games/answer", famB, at("17:01"), { sessionId: sid, index: 4, choice: 0 });
    r.record("another family cannot answer this game", stranger.status === 404, String(stranger.status));

    const fin = await call(app, "POST", "/api/v1/games/finish", famA, at("17:01"), { sessionId: sid, correct: 99, stars: 99, score: 100, answered: 5 });
    const f = data(fin);
    r.record("a forged score in finish is ignored: 3 right, 3 stars, 4 answered", fin.status === 200 && f.correct === 3 && f.stars === 3 && f.answered === 4 && f.total === 5, JSON.stringify({ c: f.correct, s: f.stars, a: f.answered }));
    const stored = (await rest().select(`game_sessions?id=eq.${sid}&select=correct,stars,status,seconds_played`)) as { correct: number; stars: number; status: string; seconds_played: number }[];
    r.record("the database holds the server's score and the minutes played", stored[0]?.correct === 3 && stored[0]?.stars === 3 && stored[0]?.status === "done" && stored[0]?.seconds_played === 60, JSON.stringify(stored[0]));
    const afterFin = await call(app, "POST", "/api/v1/games/answer", famA, at("17:01"), { sessionId: sid, index: 4, choice: answers[4] });
    r.record("a finished game takes no more answers", afterFin.status === 409 && reason(afterFin) === "finished", `${afterFin.status} ${reason(afterFin)}`);

    const dash = await call(app, "POST", "/api/v1/games/start", famA, at("17:10"), { studentId: kidA.id, game: "maths_speed" });
    const dashId = String(data(dash).sessionId ?? "");
    r.record("number dash starts, 60 seconds", dash.status === 200 && data(dash).secondsLeft === 60 && arr(data(dash).items).length > 10, `${dash.status} ${data(dash).secondsLeft}`);
    const tooLate = await call(app, "POST", "/api/v1/games/answer", famA, at("17:10", 61), { sessionId: dashId, index: 0, choice: 0 });
    r.record("nothing counts after the deadline", tooLate.status === 409 && reason(tooLate) === "time_up", `${tooLate.status} ${reason(tooLate)}`);

    // Used so far today: the quiz's 60 s and the dash's 60 s. An allowance of 2 minutes is spent.
    await call(app, "POST", "/api/v1/staff/games/settings", principal, at("17:20"), { dailyMinutes: 2 });
    const capped = await call(app, "POST", "/api/v1/games/start", famA, at("17:20"), { studentId: kidA.id, game: "maths_speed" });
    r.record("practice refused past the daily allowance", capped.status === 403 && reason(capped) === "daily_cap", `${capped.status} ${reason(capped)}`);
    const st2 = await call(app, "GET", `/api/v1/games/status?studentId=${kidA.id}`, famA, at("17:20"));
    const lim2 = obj(data(st2).limits);
    const days = arr(data(st2).days);
    const today = obj(days[days.length - 1]);
    r.record("the parent sees 2 min played, none left, 7 stars today (quiz 3 + competition 4)", lim2.usedSeconds === 120 && lim2.leftSeconds === 0 && lim2.reason === "daily_cap" && obj(data(st2).stars).today === 7 && today.seconds === 120, JSON.stringify({ lim2, today }).slice(0, 200));

    // Past the allowance (after school): a competition still plays.
    const made2 = await call(app, "POST", "/api/v1/staff/games/competitions", principal, at("17:21"), { op: "create", game: "maths_speed", sections: pair, durationMinutes: 30 });
    const cid2 = String(obj(data(made2).competition).id ?? "");
    const past = await call(app, "POST", "/api/v1/games/start", famA, at("17:22"), { studentId: kidA.id, competitionId: cid2 });
    r.record("a competition plays past the daily allowance", past.status === 200, `${past.status} ${reason(past)}`);
    if (past.status === 200) await call(app, "POST", "/api/v1/games/finish", famA, at("17:22"), { sessionId: String(data(past).sessionId) });
    const week = await call(app, "GET", `/api/v1/games/leaderboard?studentId=${kidA.id}`, famA, at("17:30"));
    const classPlayers = arr(data(week).classPlayers).map((p) => obj(p));
    r.record("the week's class board: A has 3 + 4 = 7 stars", week.status === 200 && classPlayers[0]?.stars === 7, JSON.stringify(classPlayers).slice(0, 100));

    // ── Evening ───────────────────────────────────────────────────────────
    // A competition does not run past 9 pm.
    const evening = await call(app, "POST", "/api/v1/staff/games/competitions", principal, at("20:30"), { op: "create", game: "maths_speed", sections: pair, durationMinutes: 120 });
    const eid = String(obj(data(evening).competition).id ?? "");
    const nine = await call(app, "POST", "/api/v1/games/start", famB, at("21:05"), { studentId: kidB.id, competitionId: eid });
    r.record("a competition is not played after 9 pm", nine.status === 403 && reason(nine) === "night", `${nine.status} ${reason(nine)}`);

    const night = await call(app, "POST", "/api/v1/games/start", famA, at("21:30"), { studentId: kidA.id, game: "maths_speed" });
    r.record("practice refused after 9 pm", night.status === 403 && reason(night) === "night", `${night.status} ${reason(night)}`);

    // ── 4. R6 ─────────────────────────────────────────────────────────────
    const blind = await withUnreadableTable(stateDir, "game_sessions", () => call(app, "GET", `/api/v1/games/status?studentId=${kidB.id}`, famB, at("17:00")));
    r.record("game_sessions unreadable: status is 503, not a fresh allowance", blind.status === 503, String(blind.status));
  } finally {
    await cleanup(tid);
  }
  r.finish("v1-games.acceptance");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
