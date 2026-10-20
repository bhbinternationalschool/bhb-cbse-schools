part of "api_client.dart";

// Learning games for the parent app. Mirrors /api/v1/games/* (apps/web
// lib/learningGames.server.ts). The server holds the answers, the score and
// the clock: a game arrives as questions and options only, each tap is
// judged by the server, and the limits (daily minutes, school hours, 9 pm)
// are decided there — the app only shows what it is told.

int _gi(Map<String, dynamic> j, String k) => (j[k] as num?)?.toInt() ?? 0;
int? _giOrNull(Map<String, dynamic> j, String k) => (j[k] as num?)?.toInt();

class GameLimits {
  GameLimits.fromJson(Map<String, dynamic> j)
    : dailyMinutes = _gi(j, "dailyMinutes"),
      usedSeconds = _gi(j, "usedSeconds"),
      leftSeconds = _gi(j, "leftSeconds"),
      playFrom = _s(j, "playFrom"),
      playUntil = _s(j, "playUntil"),
      schoolStart = _s(j, "schoolStart"),
      schoolEnd = _s(j, "schoolEnd"),
      canPracticeNow = _b(j, "canPracticeNow"),
      reason = j["reason"] as String?;

  final int dailyMinutes;
  final int usedSeconds;
  final int leftSeconds;
  final String playFrom;
  final String playUntil;
  final String schoolStart;
  final String schoolEnd;
  final bool canPracticeNow;

  /// night | school_hours | daily_cap | disabled, when practice is closed.
  final String? reason;
}

class GameDay {
  GameDay.fromJson(Map<String, dynamic> j)
    : date = _s(j, "date"),
      seconds = _gi(j, "seconds"),
      stars = _gi(j, "stars"),
      games = _gi(j, "games");

  final String date;
  final int seconds;
  final int stars;
  final int games;
}

class GameCompetition {
  GameCompetition.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      title = _s(j, "title"),
      game = _s(j, "game"),
      subjectLabel = _s(j, "subjectLabel"),
      questionCount = _gi(j, "questionCount"),
      opensAt = DateTime.tryParse(_s(j, "opensAt")),
      closesAt = DateTime.tryParse(_s(j, "closesAt")),
      phase = _s(j, "phase"),
      played = _b(j, "played"),
      sections = _list(
        j,
        "sections",
      ).map((s) => _s(s, "label")).where((s) => s.isNotEmpty).toList();

  final String id;
  final String title;

  /// quiz | maths_speed
  final String game;
  final String subjectLabel;
  final int questionCount;
  final DateTime? opensAt;
  final DateTime? closesAt;

  /// upcoming | open | closed | cancelled
  final String phase;
  final bool played;
  final List<String> sections;

  bool get canPlay => phase == "open" && !played;
}

class GameChapter {
  GameChapter.fromJson(Map<String, dynamic> j)
    : textbookId = _s(j, "textbookId"),
      position = _gi(j, "position"),
      name = _s(j, "name"),
      questions = _gi(j, "questions");

  final String textbookId;
  final int position;
  final String name;
  final int questions;
}

class GameSubject {
  GameSubject.fromJson(Map<String, dynamic> j)
    : subjectKey = _s(j, "subjectKey"),
      label = _s(j, "label"),
      questions = _gi(j, "questions"),
      chapters = _list(j, "chapters").map(GameChapter.fromJson).toList();

  final String subjectKey;
  final String label;
  final int questions;
  final List<GameChapter> chapters;
}

class GameStatus {
  GameStatus.fromJson(Map<String, dynamic> j)
    : childName = _s(_obj(j, "child"), "name"),
      classLabel = _s(_obj(j, "child"), "classLabel"),
      grade = _giOrNull(_obj(j, "child"), "grade"),
      limits = GameLimits.fromJson(_obj(j, "limits")),
      starsToday = _gi(_obj(j, "stars"), "today"),
      starsWeek = _gi(_obj(j, "stars"), "week"),
      starsTotal = _gi(_obj(j, "stars"), "total"),
      days = _list(j, "days").map(GameDay.fromJson).toList(),
      competitions = _list(
        j,
        "competitions",
      ).map(GameCompetition.fromJson).toList(),
      subjects = _list(
        _obj(j, "pool"),
        "subjects",
      ).map(GameSubject.fromJson).toList();

  final String childName;
  final String classLabel;

  /// Nursery -2, LKG -1, UKG 0, Class N = N; null when unknown.
  final int? grade;
  final GameLimits limits;
  final int starsToday;
  final int starsWeek;
  final int starsTotal;
  final List<GameDay> days;
  final List<GameCompetition> competitions;
  final List<GameSubject> subjects;

  bool get preschool => grade != null && grade! <= 0;
}

Map<String, dynamic> _obj(Map<String, dynamic> j, String k) {
  final v = j[k];
  return v is Map ? Map<String, dynamic>.from(v) : const {};
}

class GameItem {
  GameItem.fromJson(Map<String, dynamic> j)
    : prompt = _s(j, "prompt"),
      picture = _s(j, "picture"),
      options = ((j["options"] as List?) ?? const [])
          .map((o) => "$o")
          .toList();

  GameItem(this.prompt, this.options, {this.picture = ""});

  final String prompt;
  final String picture;
  final List<String> options;
}

class GameSession {
  GameSession.fromJson(Map<String, dynamic> j)
    : sessionId = _s(j, "sessionId"),
      game = _s(j, "game"),
      competitionId = j["competitionId"] as String?,
      items = _list(j, "items").map(GameItem.fromJson).toList(),
      secondsLeft = _gi(j, "secondsLeft"),
      revealAnswers = _b(j, "revealAnswers");

  GameSession({
    required this.sessionId,
    required this.game,
    required this.items,
    required this.secondsLeft,
    this.competitionId,
    this.revealAnswers = true,
  });

  final String sessionId;
  final String game;
  final String? competitionId;
  final List<GameItem> items;

  /// From the server's deadline: the game ends when this runs out.
  final int secondsLeft;

  /// False in a competition: the right option is shown only at the end.
  final bool revealAnswers;
}

class GameAnswerResult {
  GameAnswerResult.fromJson(Map<String, dynamic> j)
    : correct = _b(j, "correct"),
      correctIndex = _giOrNull(j, "correctIndex"),
      secondsLeft = _gi(j, "secondsLeft");

  GameAnswerResult({
    required this.correct,
    this.correctIndex,
    this.secondsLeft = 0,
  });

  final bool correct;
  final int? correctIndex;
  final int secondsLeft;
}

class GameReviewItem {
  GameReviewItem.fromJson(Map<String, dynamic> j)
    : prompt = _s(j, "prompt"),
      picture = (j["picture"] as String?) ?? "",
      options = ((j["options"] as List?) ?? const [])
          .map((o) => "$o")
          .toList(),
      chosen = _giOrNull(j, "chosen"),
      correctIndex = _gi(j, "correctIndex");

  final String prompt;
  final String picture;
  final List<String> options;
  final int? chosen;
  final int correctIndex;
}

class GameResult {
  GameResult.fromJson(Map<String, dynamic> j)
    : sessionId = _s(j, "sessionId"),
      game = _s(j, "game"),
      competitionId = j["competitionId"] as String?,
      total = _gi(j, "total"),
      answered = _gi(j, "answered"),
      correct = _gi(j, "correct"),
      stars = _gi(j, "stars"),
      seconds = _gi(j, "seconds"),
      review = _list(j, "review").map(GameReviewItem.fromJson).toList();

  final String sessionId;
  final String game;
  final String? competitionId;
  final int total;
  final int answered;
  final int correct;
  final int stars;
  final int seconds;
  final List<GameReviewItem> review;
}

class GameStanding {
  GameStanding.fromJson(Map<String, dynamic> j)
    : label = _s(j, "label").isNotEmpty ? _s(j, "label") : _s(j, "name"),
      classLabel = _s(j, "classLabel"),
      players = _gi(j, "players"),
      correct = _gi(j, "correct"),
      stars = _gi(j, "stars"),
      averageCorrect = (j["averageCorrect"] as num?)?.toDouble() ?? 0,
      seconds = _gi(j, "seconds");

  /// A section ("III-A") or a player's first name ("Aarav").
  final String label;
  final String classLabel;
  final int players;
  final int correct;
  final int stars;
  final double averageCorrect;
  final int seconds;
}

class GameLeaderboard {
  GameLeaderboard.fromJson(Map<String, dynamic> j)
    : kind = _s(j, "kind"),
      classLabel = _s(j, "classLabel"),
      title = _s(_obj(j, "competition"), "title"),
      phase = _s(_obj(j, "competition"), "phase"),
      playing = _gi(j, "playing"),
      finished = _gi(j, "finished"),
      sections = _list(
        j,
        j.containsKey("sections") ? "sections" : "schoolSections",
      ).map(GameStanding.fromJson).toList(),
      players = _list(
        j,
        j.containsKey("players") ? "players" : "classPlayers",
      ).map(GameStanding.fromJson).toList(),
      schoolPlayers = _list(
        j,
        "schoolPlayers",
      ).map(GameStanding.fromJson).toList();

  /// competition | week
  final String kind;

  /// Week: the child's class ("III-A").
  final String classLabel;
  final String title;
  final String phase;
  final int playing;
  final int finished;

  /// Competition: the competing sections. Week: the school's sections.
  final List<GameStanding> sections;

  /// Competition: top players. Week: the child's class.
  final List<GameStanding> players;
  final List<GameStanding> schoolPlayers;
}

/// What the game screens need from the server — an interface so widget tests
/// can play a game without a network.
abstract class GamesBackend {
  Future<GameStatus> gameStatus(String studentId);
  Future<GameSession> startGame(Map<String, dynamic> body);
  Future<GameAnswerResult> answerGame(String sessionId, int index, int choice);
  Future<GameResult> finishGame(String sessionId);
  Future<GameLeaderboard> gameLeaderboard(
    String studentId, {
    String? competitionId,
  });
}

class ApiGamesBackend implements GamesBackend {
  ApiGamesBackend(this.api);

  final ApiClient api;

  @override
  Future<GameStatus> gameStatus(String studentId) async => GameStatus.fromJson(
    await api._getData(
      "/api/v1/games/status?studentId=${Uri.encodeQueryComponent(studentId)}",
    ),
  );

  @override
  Future<GameSession> startGame(Map<String, dynamic> body) async =>
      GameSession.fromJson(await api._postData("/api/v1/games/start", body));

  @override
  Future<GameAnswerResult> answerGame(
    String sessionId,
    int index,
    int choice,
  ) async => GameAnswerResult.fromJson(
    await api._postData("/api/v1/games/answer", {
      "sessionId": sessionId,
      "index": index,
      "choice": choice,
    }),
  );

  @override
  Future<GameResult> finishGame(String sessionId) async => GameResult.fromJson(
    await api._postData("/api/v1/games/finish", {"sessionId": sessionId}),
  );

  @override
  Future<GameLeaderboard> gameLeaderboard(
    String studentId, {
    String? competitionId,
  }) async {
    final q = StringBuffer(
      "/api/v1/games/leaderboard?studentId=${Uri.encodeQueryComponent(studentId)}",
    );
    if (competitionId != null && competitionId.isNotEmpty) {
      q.write("&competitionId=${Uri.encodeQueryComponent(competitionId)}");
    }
    return GameLeaderboard.fromJson(await api._getData(q.toString()));
  }
}
