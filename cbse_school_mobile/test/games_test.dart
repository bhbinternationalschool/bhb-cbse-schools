// Learning games — the parent app's screens (director, 15 Oct 2026).
//
// The server holds the answers, the score and the clock (apps/web
// lib/learningGames.server.ts); these tests pin that the app only shows what
// it is told: it sends "question i, option j" and nothing about a score, it
// shows the server's verdict and the server's result, it does not reveal the
// right option in a competition, it finishes when the server's clock runs
// out, and it shows the server's limits (time played, time left, why play is
// closed) rather than deciding them.
//
// SCREENSHOTS=1 flutter test test/games_test.dart writes 375 px PNGs of each
// screen to build/screenshots/ (Arial Unicode for Latin + Devanagari).

import "dart:io";
import "dart:ui" as ui;

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/i18n/locale_controller.dart";
import "package:cbse_school_mobile/core/theme/app_theme.dart";
import "package:cbse_school_mobile/features/modules/games_screen.dart";
import "package:cbse_school_mobile/l10n/app_localizations.dart";
import "package:flutter/material.dart";
import "package:flutter/rendering.dart";
import "package:flutter/services.dart";
import "package:flutter_test/flutter_test.dart";

const _child = ParentChild(
  id: "stu_1",
  fullName: "Aarav Singh",
  admissionNo: "A-1",
  className: "III",
  sectionName: "A",
  rollNo: "4",
  photoUrl: null,
  openBalancePaise: 0,
  openBalanceLabel: "₹0",
);

Map<String, dynamic> _statusJson({
  bool canPractice = true,
  String? reason,
  int used = 600,
  int grade = 3,
}) => {
  "child": {
    "studentId": "stu_1",
    "name": "Aarav",
    "classLabel": "III-A",
    "grade": grade,
  },
  "limits": {
    "dailyMinutes": 30,
    "usedSeconds": used,
    "leftSeconds": 1800 - used,
    "playFrom": "06:00",
    "playUntil": "21:00",
    "schoolStart": "08:00",
    "schoolEnd": "14:30",
    "schoolDays": [1, 2, 3, 4, 5, 6],
    "canPracticeNow": canPractice,
    "reason": reason,
    "message": "",
    "messageHi": "",
  },
  "stars": {"today": 4, "week": 11, "total": 52},
  "days": [
    for (var i = 0; i < 7; i++)
      {"date": "2026-10-${15 + i}", "seconds": i * 120, "stars": i, "games": i},
  ],
  "competitions": [
    {
      "id": "gmc_1",
      "title": "III vs IV maths",
      "game": "quiz",
      "sections": [
        {"classId": "c3", "sectionId": "s3", "label": "III-A"},
        {"classId": "c4", "sectionId": "s4", "label": "IV-A"},
      ],
      "subjectLabel": "Mathematics",
      "questionCount": 5,
      "opensAt": "2026-10-21T10:00:00Z",
      "closesAt": "2026-10-21T11:00:00Z",
      "phase": "open",
      "played": false,
    },
  ],
  "pool": {
    "subjects": [
      {
        "subjectKey": "maths",
        "label": "Mathematics",
        "questions": 24,
        "chapters": [],
      },
    ],
  },
};

class FakeGames implements GamesBackend {
  FakeGames({this.status, this.reveal = true});

  Map<String, dynamic>? status;
  final bool reveal;
  final List<Map<String, dynamic>> starts = [];
  final List<List<Object>> answers = [];
  final List<String> finished = [];

  /// The server's answers — the app never sees these.
  final List<int> right = [1, 0, 2];

  @override
  Future<GameStatus> gameStatus(String studentId) async =>
      GameStatus.fromJson(status ?? _statusJson());

  @override
  Future<GameSession> startGame(Map<String, dynamic> body) async {
    starts.add(body);
    if (status?["limits"]["canPracticeNow"] == false &&
        body["competitionId"] == null) {
      throw ApiException("Refused", 403, "forbidden", "school_hours");
    }
    return GameSession.fromJson({
      "sessionId": "gms_1",
      "game": "quiz",
      "competitionId": body["competitionId"],
      "items": [
        {
          "prompt": "5 + 3 = ?",
          "options": ["7", "8", "9"],
        },
        {
          "prompt": "10 − 4 = ?",
          "options": ["6", "5", "4"],
        },
        {
          "prompt": "2 × 6 = ?",
          "options": ["10", "14", "12"],
        },
      ],
      "secondsLeft": 90,
      "revealAnswers": reveal,
    });
  }

  @override
  Future<GameAnswerResult> answerGame(
    String sessionId,
    int index,
    int choice,
  ) async {
    answers.add([sessionId, index, choice]);
    return GameAnswerResult(
      correct: right[index] == choice,
      correctIndex: reveal ? right[index] : null,
      secondsLeft: 80,
    );
  }

  @override
  Future<GameResult> finishGame(String sessionId) async {
    finished.add(sessionId);
    final got = answers.where((a) => right[a[1] as int] == a[2]).length;
    return GameResult.fromJson({
      "sessionId": sessionId,
      "game": "quiz",
      "competitionId": null,
      "total": 3,
      "answered": answers.length,
      "correct": got,
      "stars": got,
      "seconds": 40,
      // A competition still open: the server holds the right options back.
      "answersAt": reveal ? null : "2026-10-21T05:30:00.000Z",
      "review": [
        for (var i = 0; i < 3; i++)
          {
            "prompt": "Q${i + 1}",
            "picture": null,
            "options": ["a", "b", "c"],
            "chosen": i < answers.length ? answers[i][2] : null,
            "correctIndex": reveal ? right[i] : null,
          },
      ],
    });
  }

  @override
  Future<GameLeaderboard> gameLeaderboard(
    String studentId, {
    String? competitionId,
  }) async => GameLeaderboard.fromJson({
    "kind": "competition",
    "competition": {"title": "III vs IV maths", "phase": "closed"},
    "playing": 0,
    "finished": 3,
    "sections": [
      {
        "sectionId": "s3",
        "label": "III-A",
        "players": 2,
        "correct": 9,
        "stars": 9,
        "averageCorrect": 4.5,
      },
      {
        "sectionId": "s4",
        "label": "IV-A",
        "players": 1,
        "correct": 2,
        "stars": 2,
        "averageCorrect": 2,
      },
    ],
    "players": [
      {
        "name": "Aarav",
        "classLabel": "III-A",
        "correct": 5,
        "stars": 5,
        "seconds": 41,
      },
      {
        "name": "Sita",
        "classLabel": "III-A",
        "correct": 4,
        "stars": 4,
        "seconds": 50,
      },
    ],
  });
}

Widget _app(Widget home, {Locale locale = const Locale("en")}) => LocaleScope(
  controller: LocaleController(fallback: locale),
  child: RepaintBoundary(
    key: _boundary,
    child: MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      locale: locale,
      localizationsDelegates: L.localizationsDelegates,
      supportedLocales: L.supportedLocales,
      home: home,
    ),
  ),
);

final _shots = Platform.environment["SCREENSHOTS"] == "1";
final _boundary = GlobalKey();

Future<void> _phone(WidgetTester tester) async {
  await tester.binding.setSurfaceSize(const Size(375, 812));
  tester.view.devicePixelRatio = 2;
  addTearDown(() => tester.binding.setSurfaceSize(null));
  addTearDown(tester.view.resetDevicePixelRatio);
}

/// Kept for readability at the call sites: the whole app is the frame.
Widget _framed(Widget w) => w;

Future<void> _shot(WidgetTester tester, String name) async {
  if (!_shots) return;
  await tester.runAsync(() async {
    final ro =
        _boundary.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final img = await ro.toImage(pixelRatio: 2);
    final bytes = await img.toByteData(format: ui.ImageByteFormat.png);
    final dir = Directory("build/screenshots")..createSync(recursive: true);
    File("${dir.path}/$name.png").writeAsBytesSync(bytes!.buffer.asUint8List());
  });
}

Future<void> _loadFonts() async {
  if (!_shots) return;
  Future<ByteData> read(String p) async =>
      ByteData.view(Uint8List.fromList(File(p).readAsBytesSync()).buffer);
  final flutterRoot = Platform.environment["FLUTTER_ROOT"] ?? "";
  final fonts = "$flutterRoot/bin/cache/artifacts/material_fonts";
  final text = FontLoader("Roboto")
    ..addFont(read("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"));
  for (final f in ["Roboto-Medium.ttf", "Roboto-Bold.ttf"]) {
    if (File("$fonts/$f").existsSync()) text.addFont(read("$fonts/$f"));
  }
  await text.load();
  final icons = File(
    "$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf",
  );
  if (icons.existsSync()) {
    final l = FontLoader("MaterialIcons")..addFont(read(icons.path));
    await l.load();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(_loadFonts);

  group("parsing", () {
    test("status carries the server's limits, stars and competitions", () {
      final s = GameStatus.fromJson(_statusJson(canPractice: false, reason: "night"));
      expect(s.limits.canPracticeNow, isFalse);
      expect(s.limits.reason, "night");
      expect(s.limits.leftSeconds, 1200);
      expect([s.starsToday, s.starsWeek, s.starsTotal], [4, 11, 52]);
      expect(s.competitions.single.canPlay, isTrue);
      expect(s.competitions.single.sections, ["III-A", "IV-A"]);
      expect(s.subjects.single.subjectKey, "maths");
      expect(s.days.length, 7);
      expect(s.preschool, isFalse);
      expect(
        GameStatus.fromJson(_statusJson(grade: -1)).preschool,
        isTrue,
        reason: "LKG plays the counting game",
      );
    });

    test("a game has questions and options only — nothing to score with", () {
      final g = GameSession.fromJson({
        "sessionId": "gms_x",
        "game": "maths_speed",
        "items": [
          {
            "prompt": "How many?",
            "picture": "🍎🍎🍎",
            "options": ["3", "2", "4", "5"],
          },
        ],
        "secondsLeft": 60,
        "revealAnswers": true,
      });
      expect(g.items.single.picture, "🍎🍎🍎");
      expect(g.items.single.options.length, 4);
      expect(g.secondsLeft, 60);
    });
  });

  testWidgets("the parent sees time played, time left and stars", (tester) async {
    await _phone(tester);
    await tester.pumpWidget(
      _app(_framed(GamesScreen(backend: FakeGames(), child: _child))),
    );
    await tester.pumpAndSettle();
    expect(find.text("Played today: 10 of 30 min"), findsOneWidget);
    expect(find.text("20 min left today"), findsOneWidget);
    expect(find.text("⭐ 4"), findsOneWidget);
    expect(find.text("⭐ 52"), findsOneWidget);
    expect(find.textContaining("III vs IV maths"), findsOneWidget);
    expect(find.byKey(const ValueKey("games-refusal")), findsNothing);
    await _shot(tester, "games-home-375");
  });

  testWidgets("when the server says school hours, practice is closed and says why — competitions still open", (
    tester,
  ) async {
    await _phone(tester);
    final fake = FakeGames(
      status: _statusJson(canPractice: false, reason: "school_hours"),
    );
    await tester.pumpWidget(
      _app(_framed(GamesScreen(backend: fake, child: _child))),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey("games-refusal")), findsOneWidget);
    expect(find.textContaining("It is school time"), findsOneWidget);
    // The practice cards are disabled: tapping starts nothing.
    await tester.tap(find.byKey(const ValueKey("games-number-dash")));
    await tester.pump();
    expect(fake.starts, isEmpty);
    // The competition's Play is the server's decision, not the app's.
    await tester.tap(find.widgetWithText(FilledButton, "Play"));
    await tester.pump();
    expect(fake.starts.single, {"studentId": "stu_1", "competitionId": "gmc_1"});
    await _shot(tester, "games-school-hours-375");
  });

  testWidgets("Hindi: the screen reads in Hindi", (tester) async {
    await _phone(tester);
    await tester.pumpWidget(
      _app(
        _framed(GamesScreen(backend: FakeGames(), child: _child)),
        locale: const Locale("hi"),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text("आज खेला: 30 में से 10 मिनट"), findsOneWidget);
    expect(find.text("नंबर दौड़"), findsOneWidget);
    await _shot(tester, "games-home-hindi-375");
  });

  testWidgets("a quiz: taps go to the server as (question, option); its verdict and its score are shown", (
    tester,
  ) async {
    await _phone(tester);
    final fake = FakeGames();
    final session = await fake.startGame({"game": "quiz"});
    await tester.pumpWidget(
      _app(
        _framed(
          GamePlayScreen(
            backend: fake,
            session: session,
            title: "Mathematics",
            studentId: "stu_1",
            feedbackDelay: const Duration(milliseconds: 10),
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.text("Question 1 of 3"), findsOneWidget);
    expect(find.text("90s"), findsOneWidget);
    await _shot(tester, "games-quiz-375");

    await tester.tap(find.byKey(const ValueKey("games-option-1"))); // right
    await tester.pump();
    expect(find.text("Right!"), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 20));
    expect(find.text("Question 2 of 3"), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey("games-option-2"))); // wrong
    await tester.pump();
    expect(find.text("Not quite"), findsOneWidget);
    await _shot(tester, "games-quiz-feedback-375");
    await tester.pump(const Duration(milliseconds: 20));

    await tester.tap(find.byKey(const ValueKey("games-option-2"))); // right
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 20));
    await tester.pumpAndSettle();

    expect(fake.answers, [
      ["gms_1", 0, 1],
      ["gms_1", 1, 2],
      ["gms_1", 2, 2],
    ]);
    expect(fake.finished, ["gms_1"]);
    // The result is the server's count.
    expect(find.text("2 stars"), findsOneWidget);
    expect(find.text("2 of 3 right"), findsOneWidget);
    await _shot(tester, "games-result-375");
  });

  testWidgets("a second tap on the same question sends nothing", (tester) async {
    await _phone(tester);
    final fake = FakeGames();
    final session = await fake.startGame({"game": "quiz"});
    await tester.pumpWidget(
      _app(
        GamePlayScreen(
          backend: fake,
          session: session,
          title: "Maths",
          studentId: "stu_1",
          feedbackDelay: const Duration(seconds: 1),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey("games-option-0")));
    await tester.tap(find.byKey(const ValueKey("games-option-1")));
    await tester.pump();
    expect(fake.answers.length, 1);
    await tester.pump(const Duration(seconds: 2));
  });

  testWidgets("in a competition the right option is not shown per question", (
    tester,
  ) async {
    await _phone(tester);
    final fake = FakeGames(reveal: false);
    final session = await fake.startGame({"competitionId": "gmc_1"});
    await tester.pumpWidget(
      _app(
        GamePlayScreen(
          backend: fake,
          session: session,
          title: "III vs IV maths",
          studentId: "stu_1",
          feedbackDelay: const Duration(seconds: 1),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey("games-option-0")));
    await tester.pump();
    expect(find.text("Answer saved"), findsOneWidget);
    expect(find.text("Right!"), findsNothing);
    expect(find.text("Not quite"), findsNothing);
    await tester.pump(const Duration(seconds: 2));
  });

  testWidgets("a competition still open: the review shows the child's choices and when the answers come, never a right option", (
    tester,
  ) async {
    await _phone(tester);
    final fake = FakeGames(reveal: false);
    final session = await fake.startGame({"competitionId": "gmc_1"});
    await tester.pumpWidget(
      _app(
        _framed(
          GamePlayScreen(
            backend: fake,
            session: session,
            title: "III vs IV maths",
            studentId: "stu_1",
            feedbackDelay: const Duration(milliseconds: 10),
          ),
        ),
      ),
    );
    await tester.pump();
    for (final o in [1, 0, 0]) {
      await tester.tap(find.byKey(ValueKey("games-option-$o")));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 20));
    }
    await tester.pumpAndSettle();
    expect(fake.finished, ["gms_1"]);
    expect(find.byKey(const ValueKey("games-answers-after-close")), findsOneWidget);
    expect(find.textContaining("Right answer:"), findsNothing);
    expect(find.text("Your answer: b"), findsOneWidget);
    await _shot(tester, "games-result-competition-375");
  });

  test("a review item with no right option (competition open) parses as null, not option 0", () {
    final r = GameResult.fromJson({
      "total": 1,
      "answersAt": "2026-10-21T05:30:00.000Z",
      "review": [
        {"prompt": "Q", "options": ["a", "b"], "chosen": 1, "correctIndex": null},
      ],
    });
    expect(r.review.single.correctIndex, isNull);
    expect(r.answersAt, isNotNull);
  });

  testWidgets("when the server's clock runs out, the game finishes", (
    tester,
  ) async {
    await _phone(tester);
    final fake = FakeGames();
    final session = GameSession(
      sessionId: "gms_t",
      game: "maths_speed",
      items: [
        GameItem("1 + 1 = ?", ["2", "3"]),
      ],
      secondsLeft: 3,
    );
    await tester.pumpWidget(
      _app(
        GamePlayScreen(
          backend: fake,
          session: session,
          title: "Number dash",
          studentId: "stu_1",
        ),
      ),
    );
    await tester.pump(const Duration(seconds: 1));
    expect(find.text("2s"), findsOneWidget);
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(fake.finished, ["gms_t"]);
    expect(find.text("0 stars"), findsOneWidget);
  });

  testWidgets("a counting game shows the picture big", (tester) async {
    await _phone(tester);
    final session = GameSession(
      sessionId: "gms_p",
      game: "maths_speed",
      items: [
        GameItem("How many?", ["3", "2", "4", "5"], picture: "🍎🍎🍎"),
      ],
      secondsLeft: 60,
    );
    await tester.pumpWidget(
      _app(
        _framed(
          GamePlayScreen(
            backend: FakeGames(),
            session: session,
            title: "Count the pictures",
            studentId: "stu_1",
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.byKey(const ValueKey("games-picture")), findsOneWidget);
    expect(find.text("How many?"), findsOneWidget);
    await _shot(tester, "games-counting-375");
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets("the competition leaderboard: sections ranked, first names and class", (
    tester,
  ) async {
    await _phone(tester);
    await tester.pumpWidget(
      _app(
        _framed(
          GameLeaderboardScreen(
            backend: FakeGames(),
            studentId: "stu_1",
            competitionId: "gmc_1",
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text("III vs IV maths"), findsOneWidget);
    final first = find.byKey(const ValueKey("games-board-section-0"));
    expect(
      find.descendant(of: first, matching: find.text("III-A")),
      findsOneWidget,
    );
    expect(find.text("Aarav (III-A)"), findsOneWidget);
    expect(find.textContaining("Singh"), findsNothing);
    await _shot(tester, "games-leaderboard-375");
  });
}
