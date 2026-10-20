import "dart:async";

import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";

/// Learning games for one child (director, 15 Oct 2026).
///
/// What the parent sees first: today's minutes played and left, the child's
/// stars, the last seven days — then the games. Everything here is the
/// server's answer: whether practice is open now (school hours, 9 pm, the
/// daily allowance), which competitions the child's section is in, and which
/// subjects and chapters have enough approved questions. The app never
/// decides a limit itself.
class GamesScreen extends StatefulWidget {
  const GamesScreen({super.key, required this.backend, required this.child});

  final GamesBackend backend;
  final ParentChild child;

  @override
  State<GamesScreen> createState() => _GamesScreenState();
}

/// The server's refusal reason, in the app's language.
String gameRefusalText(BuildContext context, String? reason, String fallback) {
  final l = context.l10n;
  return switch (reason) {
    "night" => l.gamesRefusedNight,
    "school_hours" => l.gamesRefusedSchoolHours,
    "daily_cap" => l.gamesRefusedDailyCap,
    "disabled" => l.gamesRefusedDisabled,
    "competition_closed" => l.gamesRefusedClosed,
    "already_played" => l.gamesRefusedAlreadyPlayed,
    "already_playing" => l.gamesRefusedAlreadyPlaying,
    _ => fallback,
  };
}

String _hhmm(DateTime? t) {
  if (t == null) return "";
  final l = t.toLocal();
  final h = l.hour % 12 == 0 ? 12 : l.hour % 12;
  return "$h:${l.minute.toString().padLeft(2, "0")} ${l.hour < 12 ? "am" : "pm"}";
}

class _GamesScreenState extends State<GamesScreen> {
  GameStatus? _status;
  Object? _error;
  bool _starting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final s = await widget.backend.gameStatus(widget.child.id);
      if (mounted) setState(() => (_status = s, _error = null));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _start(Map<String, dynamic> body, String title) async {
    if (_starting) return;
    Haptics.tap();
    setState(() => _starting = true);
    try {
      final session = await widget.backend.startGame({
        "studentId": widget.child.id,
        ...body,
      });
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => GamePlayScreen(
            backend: widget.backend,
            session: session,
            title: title,
            studentId: widget.child.id,
          ),
        ),
      );
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(gameRefusalText(context, e.reason, e.message))),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text("$e")));
      }
    } finally {
      if (mounted) setState(() => _starting = false);
      await _load();
    }
  }

  void _pickChapter(GameSubject s) {
    final l = context.l10n;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(
              leading: const Icon(Icons.all_inclusive),
              title: Text(l.gamesWholeSubject),
              subtitle: Text(l.gamesQuestions("${s.questions}")),
              onTap: () {
                Navigator.of(ctx).pop();
                _start({"game": "quiz", "subjectKey": s.subjectKey}, s.label);
              },
            ),
            for (final c in s.chapters)
              ListTile(
                leading: CircleAvatar(radius: 14, child: Text("${c.position}")),
                title: Text(c.name),
                subtitle: Text(l.gamesQuestions("${c.questions}")),
                onTap: () {
                  Navigator.of(ctx).pop();
                  _start({
                    "game": "quiz",
                    "subjectKey": s.subjectKey,
                    "textbookId": c.textbookId,
                    "chapterPosition": c.position,
                  }, "${s.label} · ${c.name}");
                },
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final s = _status;
    return Scaffold(
      appBar: AppBar(
        title: Text(l.gamesTitle),
        actions: [
          IconButton(
            tooltip: l.gamesLeaderboard,
            icon: const Icon(Icons.leaderboard_outlined),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => GameLeaderboardScreen(
                  backend: widget.backend,
                  studentId: widget.child.id,
                ),
              ),
            ),
          ),
        ],
      ),
      body: s == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator()
                  : Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text("$_error", textAlign: TextAlign.center),
                          const SizedBox(height: 12),
                          FilledButton(onPressed: _load, child: Text(l.retry)),
                        ],
                      ),
                    ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                children: [
                  _TodayCard(status: s),
                  if (!s.limits.canPracticeNow) ...[
                    const SizedBox(height: 10),
                    _Banner(
                      text: gameRefusalText(context, s.limits.reason, ""),
                    ),
                  ],
                  if (s.competitions.isNotEmpty) ...[
                    const SizedBox(height: 18),
                    _Heading(l.gamesCompetitions),
                    for (final c in s.competitions)
                      _CompetitionTile(
                        c: c,
                        busy: _starting,
                        onPlay: () => _start({"competitionId": c.id}, c.title),
                        onBoard: () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => GameLeaderboardScreen(
                              backend: widget.backend,
                              studentId: widget.child.id,
                              competitionId: c.id,
                            ),
                          ),
                        ),
                      ),
                  ],
                  const SizedBox(height: 18),
                  _Heading(l.gamesPractice),
                  _GameCard(
                    key: const ValueKey("games-number-dash"),
                    icon: s.preschool ? "🍎" : "⚡",
                    title: s.preschool ? l.gamesCounting : l.gamesNumberDash,
                    blurb: s.preschool
                        ? l.gamesCountingBlurb
                        : l.gamesNumberDashBlurb,
                    enabled: s.limits.canPracticeNow && !_starting,
                    onTap: () => _start({
                      "game": "maths_speed",
                      "lang": Localizations.localeOf(context).languageCode ==
                              "hi"
                          ? "hi"
                          : "en",
                    }, s.preschool ? l.gamesCounting : l.gamesNumberDash),
                  ),
                  for (final sub in s.subjects)
                    _GameCard(
                      key: ValueKey("games-subject-${sub.subjectKey}"),
                      icon: "📘",
                      title: sub.label,
                      blurb: l.gamesQuestions("${sub.questions}"),
                      enabled: s.limits.canPracticeNow && !_starting,
                      onTap: () => sub.chapters.isEmpty
                          ? _start({
                              "game": "quiz",
                              "subjectKey": sub.subjectKey,
                            }, sub.label)
                          : _pickChapter(sub),
                    ),
                  if (s.subjects.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Text(
                        l.gamesNoQuizYet,
                        style: const TextStyle(color: AppColors.muted),
                      ),
                    ),
                  const SizedBox(height: 18),
                  _Heading(l.gamesLast7Days),
                  _WeekStrip(days: s.days),
                  const SizedBox(height: 14),
                  Text(
                    l.gamesHealthyNote,
                    style: const TextStyle(
                      color: AppColors.muted,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(
      text,
      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
    ),
  );
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    key: const ValueKey("games-refusal"),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: ModuleTone.amber.background,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Row(
      children: [
        Icon(Icons.bedtime_outlined, color: ModuleTone.amber.foreground),
        const SizedBox(width: 10),
        Expanded(child: Text(text)),
      ],
    ),
  );
}

class _TodayCard extends StatelessWidget {
  const _TodayCard({required this.status});

  final GameStatus status;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final lim = status.limits;
    final played = (lim.usedSeconds / 60).floor();
    final left = (lim.leftSeconds / 60).floor();
    final frac = lim.dailyMinutes == 0
        ? 0.0
        : (lim.usedSeconds / (lim.dailyMinutes * 60)).clamp(0.0, 1.0);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "${status.childName} · ${status.classLabel}",
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
            Text(
              l.gamesPlayedToday("$played", "${lim.dailyMinutes}"),
              key: const ValueKey("games-played-today"),
            ),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: frac,
                minHeight: 8,
                color: frac >= 1 ? AppColors.warning : AppColors.success,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              l.gamesTimeLeft("$left"),
              key: const ValueKey("games-time-left"),
              style: const TextStyle(color: AppColors.muted, fontSize: 12),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                _Stars(label: l.gamesStarsToday, value: status.starsToday),
                _Stars(label: l.gamesStarsWeek, value: status.starsWeek),
                _Stars(label: l.gamesStarsTotal, value: status.starsTotal),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Stars extends StatelessWidget {
  const _Stars({required this.label, required this.value});

  final String label;
  final int value;

  @override
  Widget build(BuildContext context) => Expanded(
    child: Column(
      children: [
        Text(
          "⭐ $value",
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
        ),
        Text(
          label,
          style: const TextStyle(fontSize: 12, color: AppColors.muted),
          textAlign: TextAlign.center,
        ),
      ],
    ),
  );
}

class _WeekStrip extends StatelessWidget {
  const _WeekStrip({required this.days});

  final List<GameDay> days;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
        child: Row(
          children: [
            for (final d in days)
              Expanded(
                child: Column(
                  children: [
                    Text(
                      d.date.length >= 10 ? d.date.substring(8, 10) : d.date,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      l.gamesDayMinutes("${(d.seconds / 60).ceil()}"),
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppColors.muted,
                      ),
                    ),
                    Text("⭐${d.stars}", style: const TextStyle(fontSize: 11)),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _GameCard extends StatelessWidget {
  const _GameCard({
    super.key,
    required this.icon,
    required this.title,
    required this.blurb,
    required this.enabled,
    required this.onTap,
  });

  final String icon;
  final String title;
  final String blurb;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Card(
    child: ListTile(
      enabled: enabled,
      leading: Text(icon, style: const TextStyle(fontSize: 28)),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(blurb),
      trailing: const Icon(Icons.play_circle_outline),
      onTap: enabled ? onTap : null,
    ),
  );
}

class _CompetitionTile extends StatelessWidget {
  const _CompetitionTile({
    required this.c,
    required this.busy,
    required this.onPlay,
    required this.onBoard,
  });

  final GameCompetition c;
  final bool busy;
  final VoidCallback onPlay;
  final VoidCallback onBoard;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final when = c.phase == "upcoming"
        ? l.gamesOpensAt(_hhmm(c.opensAt))
        : l.gamesClosesAt(_hhmm(c.closesAt));
    return Card(
      key: ValueKey("games-competition-${c.id}"),
      color: ModuleTone.blue.background,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "🏆 ${c.title}",
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 2),
            Text(
              "${c.sections.join(" · ")} — $when",
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                if (c.canPlay)
                  FilledButton(
                    onPressed: busy ? null : onPlay,
                    child: Text(l.gamesPlay),
                  )
                else if (c.played)
                  Chip(label: Text(l.gamesPlayed)),
                OutlinedButton(
                  onPressed: onBoard,
                  child: Text(l.gamesLeaderboard),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ── Playing ───────────────────────────────────────────────────────────────

/// One game: a question at a time, big options, the server's clock.
///
/// Each tap is sent to the server, which says whether it was right; the next
/// question follows. The countdown is the server's deadline — when it runs
/// out the game finishes, and the score is the server's count.
class GamePlayScreen extends StatefulWidget {
  const GamePlayScreen({
    super.key,
    required this.backend,
    required this.session,
    required this.title,
    required this.studentId,
    this.feedbackDelay = const Duration(milliseconds: 700),
  });

  final GamesBackend backend;
  final GameSession session;
  final String title;
  final String studentId;
  final Duration feedbackDelay;

  @override
  State<GamePlayScreen> createState() => _GamePlayScreenState();
}

class _GamePlayScreenState extends State<GamePlayScreen> {
  int _index = 0;
  late int _secondsLeft = widget.session.secondsLeft;
  Timer? _timer;
  int? _picked;
  GameAnswerResult? _last;
  bool _sending = false;
  bool _finishing = false;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _secondsLeft = (_secondsLeft - 1).clamp(0, 1 << 30));
      if (_secondsLeft <= 0) _finish();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _answer(int choice) async {
    if (_sending || _finishing || _picked != null) return;
    Haptics.tap();
    setState(() => (_sending = true, _picked = choice));
    try {
      final r = await widget.backend.answerGame(
        widget.session.sessionId,
        _index,
        choice,
      );
      if (!mounted) return;
      setState(() {
        _last = r;
        _secondsLeft = r.secondsLeft > 0 ? r.secondsLeft : _secondsLeft;
      });
      await Future<void>.delayed(widget.feedbackDelay);
      if (!mounted) return;
      if (_index + 1 >= widget.session.items.length) {
        await _finish();
      } else {
        setState(() => (_index = _index + 1, _picked = null, _last = null));
      }
    } on ApiException catch (e) {
      // time_up / finished: the server's clock ran out first.
      if (e.reason == "time_up" || e.reason == "finished") {
        await _finish();
      } else if (mounted) {
        setState(() => _picked = null);
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _finish() async {
    if (_finishing) return;
    _finishing = true;
    _timer?.cancel();
    try {
      final result = await widget.backend.finishGame(widget.session.sessionId);
      if (!mounted) return;
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => GameResultScreen(
            backend: widget.backend,
            result: result,
            studentId: widget.studentId,
          ),
        ),
      );
    } catch (e) {
      _finishing = false;
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text("$e")));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final items = widget.session.items;
    final item = items[_index.clamp(0, items.length - 1)];
    final reveal = widget.session.revealAnswers;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          Center(
            child: Padding(
              padding: const EdgeInsets.only(right: 16),
              child: Text(
                l.gamesSecondsLeft("$_secondsLeft"),
                key: const ValueKey("games-seconds-left"),
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  color: _secondsLeft <= 10 ? AppColors.danger : null,
                ),
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l.gamesQuestionOf("${_index + 1}", "${items.length}"),
                style: const TextStyle(color: AppColors.muted),
              ),
              const SizedBox(height: 4),
              LinearProgressIndicator(value: (_index + 1) / items.length),
              const SizedBox(height: 20),
              if (item.picture.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(
                    item.picture,
                    key: const ValueKey("games-picture"),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 40, height: 1.3),
                  ),
                ),
              Text(
                item.prompt,
                key: const ValueKey("games-prompt"),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 20),
              Expanded(
                child: ListView(
                  children: [
                    for (var i = 0; i < item.options.length; i++)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _OptionButton(
                          key: ValueKey("games-option-$i"),
                          text: item.options[i],
                          state: _optionState(i, reveal),
                          onTap: () => _answer(i),
                        ),
                      ),
                  ],
                ),
              ),
              if (_last != null)
                Text(
                  !reveal
                      ? l.gamesAnswerSaved
                      : (_last!.correct ? l.gamesRight : l.gamesWrong),
                  key: const ValueKey("games-feedback"),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: !reveal
                        ? AppColors.info
                        : (_last!.correct
                              ? AppColors.success
                              : AppColors.warning),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  _OptionState _optionState(int i, bool reveal) {
    final last = _last;
    if (_picked == null) return _OptionState.idle;
    if (last == null) return i == _picked ? _OptionState.picked : _OptionState.idle;
    if (!reveal) return i == _picked ? _OptionState.picked : _OptionState.idle;
    if (last.correctIndex == i) return _OptionState.right;
    if (i == _picked && !last.correct) return _OptionState.wrong;
    return _OptionState.idle;
  }
}

enum _OptionState { idle, picked, right, wrong }

class _OptionButton extends StatelessWidget {
  const _OptionButton({
    super.key,
    required this.text,
    required this.state,
    required this.onTap,
  });

  final String text;
  final _OptionState state;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (state) {
      _OptionState.right => (ModuleTone.green.background, AppColors.success),
      _OptionState.wrong => (ModuleTone.coral.background, AppColors.danger),
      _OptionState.picked => (ModuleTone.blue.background, AppColors.info),
      _OptionState.idle => (Colors.white, AppColors.ink),
    };
    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 56),
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: fg.withValues(alpha: 0.4)),
          ),
          child: Text(
            text,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w600,
              color: fg,
            ),
          ),
        ),
      ),
    );
  }
}

// ── Result ─────────────────────────────────────────────────────────────────

class GameResultScreen extends StatelessWidget {
  const GameResultScreen({
    super.key,
    required this.backend,
    required this.result,
    required this.studentId,
  });

  final GamesBackend backend;
  final GameResult result;
  final String studentId;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.gamesResultTitle)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  Text(
                    "⭐" * result.stars.clamp(0, 10),
                    style: const TextStyle(fontSize: 28),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    l.gamesStarsEarned("${result.stars}"),
                    key: const ValueKey("games-result-stars"),
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    l.gamesResultScore("${result.correct}", "${result.total}"),
                    key: const ValueKey("games-result-score"),
                  ),
                ],
              ),
            ),
          ),
          if (result.competitionId != null) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              icon: const Icon(Icons.leaderboard_outlined),
              label: Text(l.gamesSeeLeaderboard),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => GameLeaderboardScreen(
                    backend: backend,
                    studentId: studentId,
                    competitionId: result.competitionId,
                  ),
                ),
              ),
            ),
          ],
          const SizedBox(height: 16),
          Text(
            l.gamesReview,
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
          ),
          for (final r in result.review)
            Card(
              child: ListTile(
                leading: Icon(
                  r.chosen == r.correctIndex
                      ? Icons.check_circle
                      : Icons.cancel_outlined,
                  color: r.chosen == r.correctIndex
                      ? AppColors.success
                      : AppColors.warning,
                ),
                title: Text(
                  [r.picture, r.prompt].where((x) => x.isNotEmpty).join("  "),
                ),
                subtitle: Text(
                  [
                    r.chosen == null
                        ? l.gamesNotAnswered
                        : l.gamesYourAnswer(r.options[r.chosen!]),
                    l.gamesRightAnswer(r.options[r.correctIndex]),
                  ].join("\n"),
                ),
              ),
            ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(l.gamesDone),
          ),
        ],
      ),
    );
  }
}

// ── Leaderboard ────────────────────────────────────────────────────────────

/// A competition's live board (refreshed every 5 s while open) or this
/// week's stars in the class and the school. First names and class only.
class GameLeaderboardScreen extends StatefulWidget {
  const GameLeaderboardScreen({
    super.key,
    required this.backend,
    required this.studentId,
    this.competitionId,
    this.pollEvery = const Duration(seconds: 5),
  });

  final GamesBackend backend;
  final String studentId;
  final String? competitionId;
  final Duration pollEvery;

  @override
  State<GameLeaderboardScreen> createState() => _GameLeaderboardScreenState();
}

class _GameLeaderboardScreenState extends State<GameLeaderboardScreen> {
  GameLeaderboard? _board;
  Object? _error;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final b = await widget.backend.gameLeaderboard(
        widget.studentId,
        competitionId: widget.competitionId,
      );
      if (!mounted) return;
      setState(() => (_board = b, _error = null));
      _poll?.cancel();
      if (b.kind == "competition" && b.phase == "open") {
        _poll = Timer(widget.pollEvery, _load);
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final b = _board;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          b != null && b.kind == "competition" && b.title.isNotEmpty
              ? b.title
              : l.gamesLeaderboard,
        ),
      ),
      body: b == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator()
                  : Text("$_error"),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                children: b.kind == "competition"
                    ? _competition(context, b)
                    : _week(context, b),
              ),
            ),
    );
  }

  List<Widget> _competition(BuildContext context, GameLeaderboard b) {
    final l = context.l10n;
    return [
      if (b.phase == "open")
        Text(
          l.gamesPlayingNow("${b.playing}"),
          style: const TextStyle(color: AppColors.muted),
        ),
      for (var i = 0; i < b.sections.length; i++)
        Card(
          key: ValueKey("games-board-section-$i"),
          child: ListTile(
            leading: CircleAvatar(child: Text("${i + 1}")),
            title: Text(
              b.sections[i].label,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            subtitle: Text(
              "${l.gamesRightPerPlayer(b.sections[i].averageCorrect.toStringAsFixed(1))} · ${l.gamesPlayersCount("${b.sections[i].players}")}",
            ),
            trailing: Text("⭐ ${b.sections[i].stars}"),
          ),
        ),
      const SizedBox(height: 12),
      if (b.players.isEmpty) Text(l.gamesNobodyYet),
      for (var i = 0; i < b.players.length; i++)
        ListTile(
          key: ValueKey("games-board-player-$i"),
          dense: true,
          leading: Text("${i + 1}."),
          title: Text("${b.players[i].label} (${b.players[i].classLabel})"),
          trailing: Text(
            "${b.players[i].correct} ✓ · ⭐ ${b.players[i].stars}",
          ),
        ),
    ];
  }

  List<Widget> _week(BuildContext context, GameLeaderboard b) {
    final l = context.l10n;
    return [
      Text(
        l.gamesClassBoard(b.classLabel),
        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
      ),
      if (b.players.isEmpty) Text(l.gamesNobodyYet),
      for (var i = 0; i < b.players.length; i++)
        ListTile(
          dense: true,
          leading: Text("${i + 1}."),
          title: Text(b.players[i].label),
          trailing: Text("⭐ ${b.players[i].stars}"),
        ),
      const SizedBox(height: 16),
      Text(
        l.gamesSchoolBoard,
        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
      ),
      for (var i = 0; i < b.sections.length; i++)
        ListTile(
          dense: true,
          leading: Text("${i + 1}."),
          title: Text(b.sections[i].label),
          subtitle: Text(l.gamesPlayersCount("${b.sections[i].players}")),
          trailing: Text("⭐ ${b.sections[i].stars}"),
        ),
      for (var i = 0; i < b.schoolPlayers.length; i++)
        ListTile(
          dense: true,
          leading: const Icon(Icons.star_border),
          title: Text(
            "${b.schoolPlayers[i].label} (${b.schoolPlayers[i].classLabel})",
          ),
          trailing: Text("⭐ ${b.schoolPlayers[i].stars}"),
        ),
    ];
  }
}
