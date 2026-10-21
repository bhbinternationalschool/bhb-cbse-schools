/**
 * Self-test: learning games — the limits hold, the score is the server's,
 * and only playable questions come in.
 * Run: npx tsx apps/web/src/lib/learningGames.selftest.ts
 *
 *  1. Limits (director, 15 Oct 2026): a daily allowance (default 30 min),
 *     no practice in school hours on a school day unless it is a
 *     teacher-launched competition, nothing after 9 pm or before 6 am —
 *     competitions included. A game never outlasts what is left of the day's
 *     allowance or of the evening.
 *  2. The score: an answer is judged against the server's item; out-of-range
 *     indexes and options are refused; after the deadline nothing counts; the
 *     final score is counted from stored answers, one per question — a
 *     client's claimed score has nowhere to go in.
 *  3. Questions: a paper question becomes a game question only when its key
 *     names exactly one option and it needs no picture; a teacher's or the
 *     AI's draft needs 2–4 different options and one right answer.
 *  4. Leaderboards: first names and classes only; a section does not win by
 *     being bigger; a child counts once per competition.
 */

import assert from "node:assert/strict";

import {
  checkAnswer,
  checkQuestionDraft,
  competitionGradeProblem,
  competitionItemsFor,
  competitionStandings,
  DEFAULT_GAME_SETTINGS,
  firstName,
  gameGrade,
  gameLengthSeconds,
  gameQuestionFromPaper,
  gameReview,
  gradeBand,
  hhmmToMinutes,
  istParts,
  istWeekStart,
  mathsSpeedItems,
  MIN_PLAY_SECONDS,
  normalizeGameSettings,
  pickQuizItems,
  playVerdict,
  publicItems,
  readCompetitionInput,
  readItems,
  scoreAnswers,
  sessionSecondsUsed,
  settingsProblems,
  starsFor,
  stripOptionLabel,
  teachesSubjectInGrade,
  weeklyStandings,
} from "./learningGames";
import { buildGameQuestionsPrompt, freshDrafts, parseGameQuestions } from "./learningGamesAi";

console.log("learningGames.selftest.ts");

/** An instant at IST wall-clock `hhmm` on `date`. */
const ist = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00+05:30`);
const S = DEFAULT_GAME_SETTINGS;
const WED = "2026-10-21"; // a Wednesday (school day)
const SUN = "2026-10-25";
const quiz10 = gameLengthSeconds("quiz", 10);

assert.equal(istParts(ist(WED, "17:05")).weekday, 3);
assert.equal(istParts(ist(WED, "17:05")).minutes, 17 * 60 + 5);
assert.equal(istParts(ist(WED, "00:30")).date, WED, "IST day, not UTC day");
assert.equal(istWeekStart(ist(SUN, "20:00")), "2026-10-19", "week starts Monday");

// ── 1. Limits ──────────────────────────────────────────────────────────────

{
  const after = playVerdict({ nowMs: ist(WED, "17:00"), settings: S, usedSecondsToday: 0, gameSeconds: quiz10 });
  assert.deepEqual(after, { ok: true, allowSeconds: quiz10 }, "after school, nothing played: a whole game");

  const inSchool = playVerdict({ nowMs: ist(WED, "10:00"), settings: S, usedSecondsToday: 0, gameSeconds: quiz10 });
  assert.equal(inSchool.ok, false);
  assert.equal(!inSchool.ok && inSchool.reason, "school_hours", "practice is refused in school hours");

  const sunday = playVerdict({ nowMs: ist(SUN, "10:00"), settings: S, usedSecondsToday: 0, gameSeconds: quiz10 });
  assert.equal(sunday.ok, true, "Sunday morning is not school time");

  const comp = { opensAtMs: ist(WED, "09:00"), closesAtMs: ist(WED, "12:00") };
  const compInSchool = playVerdict({ nowMs: ist(WED, "10:00"), settings: S, usedSecondsToday: 0, gameSeconds: quiz10, competition: comp });
  assert.equal(compInSchool.ok, true, "a teacher-launched competition plays in school hours");

  const compCapped = playVerdict({ nowMs: ist(WED, "10:00"), settings: S, usedSecondsToday: 99 * 60, gameSeconds: quiz10, competition: comp });
  assert.equal(compCapped.ok, true, "the daily allowance does not lock a child out of a teacher's competition");

  const compClosed = playVerdict({ nowMs: ist(WED, "12:30"), settings: S, usedSecondsToday: 0, gameSeconds: quiz10, competition: comp });
  assert.equal(!compClosed.ok && compClosed.reason, "competition_closed", "after its window a competition is closed");
  const compEarly = playVerdict({ nowMs: ist(WED, "08:30"), settings: S, usedSecondsToday: 0, gameSeconds: quiz10, competition: comp });
  assert.equal(!compEarly.ok && compEarly.reason, "competition_closed", "before its window too");
  const compCancelled = playVerdict({ nowMs: ist(WED, "10:00"), settings: S, usedSecondsToday: 0, gameSeconds: quiz10, competition: { ...comp, cancelled: true } });
  assert.equal(!compCancelled.ok && compCancelled.reason, "competition_closed");

  const lateComp = { opensAtMs: ist(WED, "20:00"), closesAtMs: ist(WED, "23:00") };
  const nine = playVerdict({ nowMs: ist(WED, "21:00"), settings: S, usedSecondsToday: 0, gameSeconds: quiz10, competition: lateComp });
  assert.equal(!nine.ok && nine.reason, "night", "9 pm stops a competition too");
  const ten = playVerdict({ nowMs: ist(WED, "22:15"), settings: S, usedSecondsToday: 0, gameSeconds: quiz10 });
  assert.equal(!ten.ok && ten.reason, "night", "no practice at 10 pm");
  const dawn = playVerdict({ nowMs: ist(SUN, "05:30"), settings: S, usedSecondsToday: 0, gameSeconds: quiz10 });
  assert.equal(!dawn.ok && dawn.reason, "night", "nor before 6 am");

  // 8:58 pm: a 5-minute quiz is cut to the two minutes before 9.
  const nearNine = playVerdict({ nowMs: ist(WED, "20:58"), settings: S, usedSecondsToday: 0, gameSeconds: quiz10 });
  assert.deepEqual(nearNine, { ok: true, allowSeconds: 120 }, "a game ends at 9 pm, not after");
  const lateComp2 = playVerdict({ nowMs: ist(WED, "20:58"), settings: S, usedSecondsToday: 0, gameSeconds: quiz10, competition: lateComp });
  assert.deepEqual(lateComp2, { ok: true, allowSeconds: 120 }, "so does a competition game");

  // The allowance: 30 minutes.
  const used29 = playVerdict({ nowMs: ist(WED, "17:00"), settings: S, usedSecondsToday: 29 * 60, gameSeconds: quiz10 });
  assert.deepEqual(used29, { ok: true, allowSeconds: 60 }, "a game is cut to what is left of the allowance");
  const used30 = playVerdict({ nowMs: ist(WED, "17:00"), settings: S, usedSecondsToday: 30 * 60, gameSeconds: quiz10 });
  assert.equal(!used30.ok && used30.reason, "daily_cap", "past the allowance: refused");
  const almost = playVerdict({ nowMs: ist(WED, "17:00"), settings: S, usedSecondsToday: 30 * 60 - (MIN_PLAY_SECONDS - 1), gameSeconds: quiz10 });
  assert.equal(!almost.ok && almost.reason, "daily_cap", "a few seconds left is not a game");
  const bigCap = playVerdict({ nowMs: ist(WED, "17:00"), settings: { ...S, dailyMinutes: 60 }, usedSecondsToday: 30 * 60, gameSeconds: quiz10 });
  assert.equal(bigCap.ok, true, "the school can set a larger allowance");

  const off = playVerdict({ nowMs: ist(WED, "17:00"), settings: { ...S, enabled: false }, usedSecondsToday: 0, gameSeconds: quiz10, competition: { opensAtMs: 0, closesAtMs: Infinity } });
  assert.equal(!off.ok && off.reason, "disabled", "switched off is off, competitions too");
  assert.ok(!used30.ok && used30.messageHi.length > 0, "every refusal has Hindi");
}

{
  // Settings come in from a form.
  const n = normalizeGameSettings({ dailyMinutes: "45", playUntil: "20:30", schoolDays: [1, 2, 9, 2, -1], enabled: "yes" as unknown as boolean });
  assert.equal(n.dailyMinutes, 45);
  assert.equal(n.playUntil, "20:30");
  assert.deepEqual(n.schoolDays, [1, 2]);
  assert.equal(n.enabled, true, "a non-boolean keeps the default");
  assert.equal(normalizeGameSettings({ dailyMinutes: 0 }).dailyMinutes, 30, "0 minutes is not an allowance");
  assert.equal(normalizeGameSettings({ dailyMinutes: 9999 }).dailyMinutes, 30);
  assert.equal(normalizeGameSettings({ playFrom: "25:00" }).playFrom, "06:00");
  assert.deepEqual(settingsProblems({ ...S, playUntil: "22:00" }), ["Play may not run past 9 pm."], "the school cannot move 9 pm later");
  assert.deepEqual(settingsProblems(S), []);
}

{
  // Minutes used: start to end, never past the deadline.
  const start = ist(WED, "17:00");
  assert.equal(sessionSecondsUsed({ startedAtMs: start, deadlineAtMs: start + 300_000, endedAtMs: start + 90_000 }, start + 999_999), 90);
  assert.equal(sessionSecondsUsed({ startedAtMs: start, deadlineAtMs: start + 300_000, endedAtMs: null }, start + 999_999), 300, "an abandoned game counts to its deadline");
  assert.equal(sessionSecondsUsed({ startedAtMs: start, deadlineAtMs: start + 300_000, endedAtMs: null }, start + 60_000), 60, "an open game counts to now");
}

// ── 2. The score is the server's ───────────────────────────────────────────

{
  const items = [
    { prompt: "2 + 2", options: ["3", "4", "5"], answer: 1 },
    { prompt: "3 + 3", options: ["6", "7"], answer: 0 },
    { prompt: "5 − 1", options: ["2", "3", "4", "5"], answer: 2 },
  ];
  const pub = publicItems(items);
  assert.ok(pub.every((p) => !("answer" in p)), "a phone is never sent the answer");
  assert.equal(JSON.stringify(pub).includes("answer"), false);

  const now = 1_000;
  const deadline = 2_000;
  const ok = checkAnswer({ items, index: 0, choice: 1, nowMs: now, deadlineAtMs: deadline, finished: false });
  assert.deepEqual(ok, { ok: true, correct: true, correctIndex: 1 });
  const wrong = checkAnswer({ items, index: 0, choice: 0, nowMs: now, deadlineAtMs: deadline, finished: false });
  assert.deepEqual(wrong, { ok: true, correct: false, correctIndex: 1 });
  for (const [index, choice, code] of [
    [3, 0, "bad_index"],
    [-1, 0, "bad_index"],
    [0.5, 0, "bad_index"],
    [1, 2, "bad_choice"],
    [1, -1, "bad_choice"],
    [1, Number.NaN, "bad_choice"],
  ] as const) {
    const r = checkAnswer({ items, index, choice, nowMs: now, deadlineAtMs: deadline, finished: false });
    assert.equal(!r.ok && r.code, code, `index ${index} choice ${choice}`);
  }
  const late = checkAnswer({ items, index: 0, choice: 1, nowMs: deadline + 1, deadlineAtMs: deadline, finished: false });
  assert.equal(!late.ok && late.code, "time_up", "after the deadline an answer does not count");
  const over = checkAnswer({ items, index: 0, choice: 1, nowMs: now, deadlineAtMs: deadline, finished: true });
  assert.equal(!over.ok && over.code, "finished");

  // The final score, from stored answers only; repeats and strangers ignored.
  const score = scoreAnswers(items, [
    { idx: 0, chosen: 1 },
    { idx: 0, chosen: 1 },
    { idx: 1, chosen: 1 },
    { idx: 7, chosen: 0 },
  ]);
  assert.deepEqual(score, { answered: 2, correct: 1 }, "one answer per question; an unknown question counts nothing");
  // A forged score: the only input to scoring is the list of answers, so a
  // client claiming 10/10 changes nothing. (The finish route reads only the
  // session id — see app/api/v1/games/finish and e2e/v1-games.acceptance.ts.)
  const forged = { correct: 10, stars: 99, score: 100 };
  assert.deepEqual(scoreAnswers(items, []), { answered: 0, correct: 0 }, `forged ${JSON.stringify(forged)} has no way in`);

  assert.equal(starsFor("quiz", 7), 7, "a star per right answer");
  assert.equal(starsFor("maths_speed", 7), 3, "number dash: a star per two");
  assert.equal(starsFor("quiz", -3), 0);

  // Stored items read back: malformed ones are dropped, not repaired.
  assert.equal(readItems([{ prompt: "x", options: ["a", "b"], answer: 2 }, { prompt: "y", options: ["a"], answer: 0 }, "junk"]).length, 0);
  assert.equal(readItems(items).length, 3);
}

{
  // Quiz items: shuffled, the answer follows its option.
  const pool = [
    { id: "q1", prompt: "Capital of India?", options: ["Delhi", "Mumbai", "Pune"], answerIndex: 0 },
    { id: "q2", prompt: "Water is wet", options: ["True", "False"], answerIndex: 0 },
    { id: "q3", prompt: "2 × 3", options: ["5", "6", "7", "8"], answerIndex: 1 },
  ];
  for (let seed = 1; seed < 40; seed++) {
    const items = pickQuizItems(pool, 3, seed);
    assert.equal(items.length, 3);
    for (const it of items) {
      const src = pool.find((p) => p.id === it.qid)!;
      assert.equal(it.options[it.answer], src.options[src.answerIndex], "the right option is still right after the shuffle");
      if (src.id === "q2") assert.deepEqual(it.options, ["True", "False"], "True/False keep their order");
    }
  }
  assert.equal(pickQuizItems(pool, 2, 5).length, 2);
}

{
  // Number dash: right answers among four different options, pitched by age.
  for (const grade of [-2, -1, 0, 1, 2, 3, 5, 6, 8, 9, 12]) {
    const items = mathsSpeedItems(grade, 42, 40);
    assert.equal(items.length, 40);
    for (const it of items) {
      assert.equal(new Set(it.options).size, 4, `grade ${grade}: four different options`);
      assert.ok(it.answer >= 0 && it.answer < 4);
    }
  }
  const nursery = mathsSpeedItems(-2, 7, 40);
  for (const it of nursery) {
    const n = Number(it.options[it.answer]);
    assert.ok(n >= 1 && n <= 5, "Nursery counts to 5");
    assert.equal([...(it.picture ?? "")].length, n, "the picture shows exactly that many");
    assert.ok(it.options.every((o) => Number(o) >= 1), "no zero or negative counts offered");
  }
  assert.equal(mathsSpeedItems(-1, 1, 3, true)[0]!.prompt, "कितने हैं?", "Hindi counting prompt");
  // Same seed, same game (a test can replay one); a new seed, a new game.
  assert.deepEqual(mathsSpeedItems(4, 9), mathsSpeedItems(4, 9));
  assert.notDeepEqual(mathsSpeedItems(4, 9), mathsSpeedItems(4, 10));
  // Every class 3–5 sum is right.
  for (const it of mathsSpeedItems(4, 3, 200)) {
    const m = it.prompt.match(/^(\d+) ([+−×]) (\d+) = \?$/)!;
    const [a, op, b] = [Number(m[1]), m[2], Number(m[3])];
    const want = op === "+" ? a + b : op === "−" ? a - b : a * b;
    assert.equal(Number(it.options[it.answer]), want, it.prompt);
  }
}

// ── 3. Questions coming in ─────────────────────────────────────────────────

{
  const ok = gameQuestionFromPaper({ type: "mcq", text: "A gate made of which material will rust?", options: ["Aluminium", "Gold", "Iron", "Copper"], answerKey: "Iron", images: [] });
  assert.ok(ok.ok && ok.q.answerIndex === 2 && ok.lang === "en");
  const labelled = gameQuestionFromPaper({ type: "mcq", text: "भारत की नदी कौन-सी है?", options: ["ताप्ती", "नदी", "झील", "समुद्र"], answerKey: "(i) ताप्ती" });
  assert.ok(labelled.ok && labelled.q.answerIndex === 0 && labelled.lang === "hi", "a key written '(i) ताप्ती' names option one");
  const tf = gameQuestionFromPaper({ type: "true_false", text: "Whales breathe with lungs.", answerKey: "True" });
  assert.ok(tf.ok && tf.q.options.join() === "True,False" && tf.q.answerIndex === 0);
  const tfHi = gameQuestionFromPaper({ type: "true_false", text: "सूरज पूरब में उगता है।", answerKey: "True" });
  assert.ok(tfHi.ok && tfHi.q.options.join() === "सही,गलत");
  const refusals: [Parameters<typeof gameQuestionFromPaper>[0], string][] = [
    [{ type: "short", text: "Define rust.", answerKey: "Iron oxide" }, "not multiple choice"],
    [{ type: "mcq", text: "", options: ["ताप्ती", "नदी"], answerKey: "ताप्ती" }, "no question text"],
    [{ type: "mcq", text: "Which?", options: ["a", "b"], answerKey: "" }, "no answer in the key"],
    [{ type: "mcq", text: "Which animal is this?", options: ["Cat", "Dog"], answerKey: "Cat", images: [{}] }, "needs its picture"],
    [{ type: "mcq", text: "चित्र पहचानकर नाम पर निशान लगाओ", options: ["टब", "बस"], answerKey: "बस" }, "refers to a picture"],
    [{ type: "mcq", text: "Look at the figure and choose", options: ["A", "B"], answerKey: "A" }, "refers to a picture"],
    [{ type: "mcq", text: "Pick one", options: ["Iron", "Gold"], answerKey: "Silver" }, "key does not name exactly one option"],
    [{ type: "mcq", text: "Pick one", options: ["Iron", "iron"], answerKey: "Iron" }, "key does not name exactly one option"],
    [{ type: "mcq", text: "Pick one", options: ["Iron"], answerKey: "Iron" }, "needs 2 to 4 options"],
    [{ type: "true_false", text: "X", answerKey: "Maybe" }, "key is not True or False"],
  ];
  for (const [q, reason] of refusals) {
    const r = gameQuestionFromPaper(q);
    assert.equal(!r.ok && r.reason, reason, JSON.stringify(q));
  }
  assert.equal(stripOptionLabel("(b). Iron"), "Iron");
  assert.equal(stripOptionLabel("a) Iron"), "Iron");
  assert.equal(stripOptionLabel("3D shapes"), "3D shapes", "a number that is part of the text stays");

  assert.ok(checkQuestionDraft({ prompt: "2+2?", options: ["3", "4"], answerIndex: 1 }).ok);
  for (const bad of [
    { prompt: "", options: ["a", "b"], answerIndex: 0 },
    { prompt: "x", options: ["a", "a"], answerIndex: 0 },
    { prompt: "x", options: ["a", "b", "c", "d", "e"], answerIndex: 0 },
    { prompt: "x", options: ["a", "All of the above"], answerIndex: 0 },
    { prompt: "x", options: ["a", "b"], answerIndex: 2 },
    { prompt: "x", options: ["a", ""], answerIndex: 0 },
  ]) {
    assert.equal(checkQuestionDraft(bad).ok, false, JSON.stringify(bad));
  }

  // The AI's reply: only drafts that pass, no repeats, at most `count`.
  const reply = `Here you go: {"questions":[
    {"prompt":"Which is a fruit? 🍎 🚗","options":["Apple","Car"],"answer":0},
    {"prompt":"Which is a fruit? 🍎 🚗","options":["Apple","Car"],"answer":0},
    {"prompt":"Bad","options":["A","A"],"answer":0},
    {"prompt":"Out of range","options":["A","B"],"answer":5},
    {"prompt":"Sky colour?","options":["Blue","Green","None of the above"],"answer":0},
    {"prompt":"2+3?","options":["5","6","7"],"answer":"0"}
  ]}`;
  const parsed = parseGameQuestions(reply, 10)!;
  assert.deepEqual(
    parsed.map((q) => q.prompt),
    ["Which is a fruit? 🍎 🚗", "2+3?"],
    "duplicates, broken options, out-of-range answers and 'none of the above' are dropped",
  );
  assert.equal(parseGameQuestions("no json", 10), null);
  assert.equal(parseGameQuestions('{"questions":[{"prompt":"x","options":["a","a"],"answer":0}]}', 10), null, "nothing usable is a failed call");
  assert.equal(parseGameQuestions(reply, 1)!.length, 1);
}

// ── 4. Names, grades, leaderboards ─────────────────────────────────────────

{
  assert.equal(firstName("  Aarav   Kumar Singh "), "Aarav");
  assert.equal(firstName(""), "Player");
  assert.equal(gameGrade("Nursery"), -2);
  assert.equal(gameGrade("LKG"), -1);
  assert.equal(gameGrade("UKG"), 0);
  assert.equal(gameGrade("Class III"), 3);
  assert.equal(gameGrade("VIII"), 8);
  assert.equal(gameGrade("X"), 10);
  assert.equal(gameGrade("Class 12"), 12);
  assert.equal(gameGrade("Staff room"), null);

  const sections = [
    { sectionId: "a", label: "III-A" },
    { sectionId: "b", label: "IV-A" },
  ];
  const p = (studentId: string, sectionId: string, correct: number, secondsPlayed = 100) => ({
    studentId,
    playerName: `${studentId.toUpperCase()} Surname`,
    classLabel: sectionId === "a" ? "III-A" : "IV-A",
    sectionId,
    correct,
    stars: correct,
    secondsPlayed,
    done: true,
  });
  const st = competitionStandings(sections, [
    p("ravi", "a", 6),
    p("sita", "a", 6),
    p("ravi", "a", 10), // a second row for the same child is ignored
    p("om", "b", 8, 90),
    p("ira", "b", 9, 120),
    p("jay", "b", 1),
    p("zed", "z", 10), // not a competing section
  ]);
  assert.equal(st.sections[0]!.label, "IV-A", "IV-A: 18 right over 3 players = 6.0 … ");
  assert.equal(st.sections[0]!.averageCorrect, 6);
  assert.equal(st.sections[1]!.label, "III-A");
  assert.equal(st.sections[1]!.averageCorrect, 6, "… III-A 12 over 2 = 6.0: ties go to more players");
  assert.equal(st.sections[1]!.players, 2, "a child counts once");
  assert.deepEqual(
    st.players.map((x) => x.name),
    ["IRA", "OM", "RAVI", "SITA", "JAY"],
    "players by right answers, then faster time; the stranger is not on it",
  );
  assert.ok(st.players.every((x) => !x.name.includes("Surname")), "first names only");
  assert.ok(st.players.every((x) => Object.keys(x).sort().join() === "classLabel,correct,name,seconds,stars"), "no ids, phones or photos");

  const wk = weeklyStandings([p("ravi", "a", 6), p("ravi", "a", 4), p("om", "b", 3), { ...p("x", "b", 50), done: false }]);
  assert.deepEqual(wk.players, [
    { name: "RAVI", classLabel: "III-A", stars: 10 },
    { name: "OM", classLabel: "IV-A", stars: 3 },
  ], "a week adds a child's games; an unfinished game is not counted");
  assert.deepEqual(wk.sections.map((s) => [s.label, s.stars, s.players]), [["III-A", 10, 1], ["IV-A", 3, 1]]);
}

{
  // A competition form.
  const now = ist(WED, "09:00");
  const ok = readCompetitionInput({ game: "quiz", subjectKey: "maths", sections: [{ classId: "c3", sectionId: "s3" }, { classId: "c4", sectionId: "s4" }], durationMinutes: 30 }, now);
  assert.ok(ok.ok && ok.input.closesAtMs - ok.input.opensAtMs === 30 * 60_000 && ok.input.questionCount === 10);
  const one = readCompetitionInput({ game: "quiz", subjectKey: "maths", sections: [{ classId: "c3", sectionId: "s3" }, { classId: "c3", sectionId: "s3" }], durationMinutes: 30 }, now);
  assert.equal(!one.ok && one.error, "Pick at least two sections to compete.", "the same section twice is one section");
  const noSubject = readCompetitionInput({ game: "quiz", sections: [{ classId: "c3", sectionId: "s3" }, { classId: "c4", sectionId: "s4" }], durationMinutes: 30 }, now);
  assert.equal(noSubject.ok, false);
  const past = readCompetitionInput({ game: "maths_speed", sections: [{ classId: "c3", sectionId: "s3" }, { classId: "c4", sectionId: "s4" }], durationMinutes: 30, opensAt: new Date(now - 3600_000).toISOString() }, now);
  assert.equal(past.ok, false, "cannot open in the past");
  const tooShort = readCompetitionInput({ game: "maths_speed", sections: [{ classId: "c3", sectionId: "s3" }, { classId: "c4", sectionId: "s4" }], durationMinutes: 2 }, now);
  assert.equal(tooShort.ok, false);
  // Review fix 2 (21 Oct): at most an hour, on one IST day — a competition is
  // the one way into school hours, so it cannot hold them open for a week.
  const pairCD = [{ classId: "c3", sectionId: "s3" }, { classId: "c4", sectionId: "s4" }];
  const hour = readCompetitionInput({ game: "maths_speed", sections: pairCD, durationMinutes: 60 }, now);
  assert.ok(hour.ok && hour.input.closesAtMs - hour.input.opensAtMs === 60 * 60_000, "an hour is allowed");
  const overHour = readCompetitionInput({ game: "maths_speed", sections: pairCD, durationMinutes: 61 }, now);
  assert.equal(!overHour.ok && overHour.error, "Run it for 5 to 60 minutes.", "61 minutes is refused");
  const week = readCompetitionInput({ game: "maths_speed", sections: pairCD, durationMinutes: 7 * 24 * 60 }, now);
  assert.equal(week.ok, false, "a week-long competition is refused");
  const lateNight = ist(WED, "23:30");
  const overMidnight = readCompetitionInput({ game: "maths_speed", sections: pairCD, durationMinutes: 45 }, lateNight);
  assert.equal(!overMidnight.ok && overMidnight.error, "A competition must start and end on the same day.", "23:30 + 45 min crosses into Thursday");
  const toMidnight = readCompetitionInput({ game: "maths_speed", sections: pairCD, durationMinutes: 30 }, lateNight);
  assert.ok(toMidnight.ok, "ending at midnight exactly is the same day");
  const slowForm = readCompetitionInput({ game: "maths_speed", sections: pairCD, durationMinutes: 60, opensAt: new Date(now - 3 * 60_000).toISOString() }, now);
  assert.ok(slowForm.ok && slowForm.input.opensAtMs === now && slowForm.input.closesAtMs - slowForm.input.opensAtMs === 60 * 60_000, "a start a few minutes ago opens now; the window is never longer than an hour");
  const many = readCompetitionInput({ game: "quiz", subjectKey: "maths", questionCount: 99, sections: [{ classId: "c3", sectionId: "s3" }, { classId: "c4", sectionId: "s4" }], durationMinutes: 30 }, now);
  assert.ok(many.ok && many.input.questionCount === 20, "at most 20 questions");
}

// ── 5. Review fixes (21 Oct 2026) ──────────────────────────────────────────

{
  // Fix 1: in a competition the answer review waits for the close, and each
  // player gets their own question and option order.
  const items = [
    { prompt: "2 + 2", options: ["3", "4", "5"], answer: 1 },
    { prompt: "Capital?", options: ["Delhi", "Pune", "Agra", "Goa"], answer: 0 },
    { prompt: "Water is wet", options: ["True", "False"], answer: 0 },
    { prompt: "3 × 3", options: ["6", "9", "12", "8"], answer: 1 },
    { prompt: "10 − 7", options: ["3", "2", "4", "7"], answer: 0 },
    { prompt: "Big?", options: ["99", "909", "990"], answer: 2 },
  ];
  const chosen = new Map([[0, 1], [1, 2]]);
  const closes = ist(WED, "11:00");
  const open = gameReview(items, chosen, { competitionClosesAtMs: closes, nowMs: ist(WED, "10:30") });
  assert.equal(open.answersShown, false);
  assert.ok(open.review.every((r) => r.correctIndex === null), "a competition still open: no right options in the review");
  assert.equal(open.answersAt, new Date(closes).toISOString(), "it says when they appear");
  assert.deepEqual(open.review[1]!.chosen, 2, "the child's own choice is shown");
  const closed = gameReview(items, chosen, { competitionClosesAtMs: closes, nowMs: closes });
  assert.deepEqual(closed.review.map((r) => r.correctIndex), [1, 0, 0, 1, 0, 2], "after the close: the right options");
  assert.equal(closed.answersAt, null);
  const practice = gameReview(items, chosen, { competitionClosesAtMs: null, nowMs: ist(WED, "17:00") });
  assert.ok(practice.answersShown && practice.review[0]!.correctIndex === 1, "practice shows the answers at once");
  const lost = gameReview(items, chosen, { competitionClosesAtMs: Number.POSITIVE_INFINITY, nowMs: ist(WED, "17:00") });
  assert.ok(!lost.answersShown && lost.answersAt === null, "an unknown close holds them back");

  const a = competitionItemsFor(items, 101);
  const b = competitionItemsFor(items, 202);
  assert.deepEqual(competitionItemsFor(items, 101), a, "the same child gets the same copy back");
  assert.deepEqual(a.map((x) => x.prompt).sort(), items.map((x) => x.prompt).sort(), "the same questions for everyone");
  for (const copy of [a, b]) {
    for (const it of copy) {
      const src = items.find((x) => x.prompt === it.prompt)!;
      assert.equal(it.options[it.answer], src.options[src.answer], "the answer follows its option");
      if (src.prompt === "Water is wet") assert.deepEqual(it.options, ["True", "False"]);
    }
  }
  const layout = (c: typeof a) => c.map((x) => `${x.prompt}:${x.options.join("/")}`).join("|");
  assert.notEqual(layout(a), layout(b), "two children do not see the same order");
  assert.notEqual(layout(a), layout(items), "nor the competition's stored order");
}

{
  // Fix 2: competition minutes count towards the day; once the allowance is
  // used no new practice starts, while a competition game runs its length.
  const comp = { opensAtMs: ist(WED, "17:00"), closesAtMs: ist(WED, "18:00") };
  const compAfterCap = playVerdict({ nowMs: ist(WED, "17:10"), settings: S, usedSecondsToday: 30 * 60, gameSeconds: quiz10, competition: comp });
  assert.deepEqual(compAfterCap, { ok: true, allowSeconds: quiz10 }, "a competition game is not cut to the allowance");
  const practiceAfterComp = playVerdict({ nowMs: ist(WED, "17:30"), settings: S, usedSecondsToday: 25 * 60 + quiz10, gameSeconds: quiz10 });
  assert.equal(!practiceAfterComp.ok && practiceAfterComp.reason, "daily_cap", "25 min practice + a 5-min competition: no new practice game");
  // School hours open only inside the window.
  const before = playVerdict({ nowMs: ist(WED, "09:59"), settings: S, usedSecondsToday: 0, gameSeconds: quiz10, competition: { opensAtMs: ist(WED, "10:00"), closesAtMs: ist(WED, "11:00") } });
  assert.equal(!before.ok && before.reason, "competition_closed");
}

{
  // Fix 3: 9 pm is the latest — "24:00" is not a time any more, and a row
  // that says later still stops at 9.
  assert.equal(hhmmToMinutes("24:00"), null, "no '24:00 = no cut-off'");
  assert.equal(normalizeGameSettings({ playUntil: "24:00" }).playUntil, "21:00");
  const lateRow = playVerdict({ nowMs: ist(WED, "21:30"), settings: { ...S, playUntil: "23:00" }, usedSecondsToday: 0, gameSeconds: quiz10 });
  assert.equal(!lateRow.ok && lateRow.reason, "night", "a stored 23:00 still stops play at 9 pm");
  const cut = playVerdict({ nowMs: ist(WED, "20:58"), settings: { ...S, playUntil: "23:00" }, usedSecondsToday: 0, gameSeconds: quiz10 });
  assert.deepEqual(cut, { ok: true, allowSeconds: 120 }, "and cuts a game at 9 pm");
}

{
  // Fix 5: review rights are the subject in the grade.
  const teaching = [
    { className: "III", subjects: [{ name: "General Knowledge", code: "GK" }] },
    { className: "V", subjects: [{ name: "Mathematics", code: "MATH" }] },
  ];
  assert.equal(teachesSubjectInGrade(teaching, 3, "gk"), true, "GK in Class III: yes");
  assert.equal(teachesSubjectInGrade(teaching, 3, "maths"), false, "maths in Class III: no — the grade alone is not enough");
  assert.equal(teachesSubjectInGrade(teaching, 5, "maths"), true);
  assert.equal(teachesSubjectInGrade(teaching, 4, "gk"), false, "not a grade they teach");
  assert.equal(teachesSubjectInGrade(teaching, 3, ""), false);
  assert.equal(teachesSubjectInGrade([{ className: "UKG", subjects: [{ name: "", code: "EVS" }] }], 0, "evs"), true, "matched by code when the name says nothing");
}

{
  // Fix 6: grade bands — pre-primary, I–II, III–V, VI–VIII, IX–X, XI–XII.
  assert.deepEqual([-2, -1, 0, 1, 2, 3, 5, 6, 8, 9, 10, 11, 12].map(gradeBand), [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(competitionGradeProblem([3, 4]), null, "III vs IV: same band");
  assert.equal(competitionGradeProblem([2, 3]), null, "II vs III: neighbouring bands");
  assert.equal(competitionGradeProblem([0, 1, 2]), null, "UKG, I, II: neighbouring");
  assert.ok(competitionGradeProblem([0, 3]), "UKG vs III: two bands apart — refused");
  assert.ok(competitionGradeProblem([1, 2, 6]), "I, II and VI: refused");
  assert.equal(competitionGradeProblem([9, 12]), null, "IX vs XII: neighbouring bands (IX–X, XI–XII)");
  assert.ok(competitionGradeProblem([8, 11]), "VIII vs XI: refused");
  assert.ok(competitionGradeProblem([3, null]), "a class with no grade cannot be placed");
}

{
  // Fix 8: asking the AI again for a chapter is a different request, and a
  // draft already in the pool is not counted as new.
  const facts = { className: "III", grade: 3, subjectLabel: "Mathematics", bookName: "Maths Magic", chapterName: "Fun with numbers", topics: ["place value"], lang: "en" as const, count: 10 };
  const first = buildGameQuestionsPrompt(facts);
  const again = buildGameQuestionsPrompt({ ...facts, avoid: ["What is 3 + 4?", "Which is bigger, 45 or 54?"] });
  assert.notEqual(again, first, "the second ask is a different request (and cache key)");
  assert.ok(again.includes("What is 3 + 4?") && /do NOT repeat/.test(again), "it lists what not to repeat");
  assert.equal(buildGameQuestionsPrompt({ ...facts, avoid: [] }), first, "nothing to avoid: the same request as before");
  const drafts = [
    { prompt: "What is 3 + 4?", options: ["7", "8"], answerIndex: 0 },
    { prompt: "What is 5 + 5?", options: ["10", "11"], answerIndex: 0 },
  ];
  assert.deepEqual(freshDrafts(drafts, ["  what is 3 +  4? "]).map((d) => d.prompt), ["What is 5 + 5?"], "a repeat (any case or spacing) is dropped");
  assert.equal(freshDrafts(drafts.slice(0, 1), ["What is 3 + 4?"]).length, 0, "all repeats: nothing new (the route says so — 409, not a silent 0)");
}

{
  // Fix 9: a holiday in the school's calendar has no school hours.
  const holidayMorning = playVerdict({ nowMs: ist(WED, "10:00"), settings: S, usedSecondsToday: 0, gameSeconds: quiz10, holiday: true });
  assert.deepEqual(holidayMorning, { ok: true, allowSeconds: quiz10 }, "a holiday Wednesday at 10 am: practice is open");
  const holidayNight = playVerdict({ nowMs: ist(WED, "21:15"), settings: S, usedSecondsToday: 0, gameSeconds: quiz10, holiday: true });
  assert.equal(!holidayNight.ok && holidayNight.reason, "night", "9 pm still holds on a holiday");
  const holidayCap = playVerdict({ nowMs: ist(WED, "10:00"), settings: S, usedSecondsToday: 30 * 60, gameSeconds: quiz10, holiday: true });
  assert.equal(!holidayCap.ok && holidayCap.reason, "daily_cap", "and so does the allowance");
}

console.log("  ✓ limits: allowance, school hours (competitions excepted), 9 pm for everyone");
console.log("  ✓ score: server-judged answers, one per question, nothing after the deadline");
console.log("  ✓ questions: only keyed, picture-free, single-answer items come in");
console.log("  ✓ leaderboards: first name + class, per-player ranking, one attempt each");
console.log("  ✓ review fixes: competition answers held to the close, own order per player; ≤60 min one-day windows; 9 pm max; subject+grade reviewers; grade bands; fresh AI drafts; holidays");
