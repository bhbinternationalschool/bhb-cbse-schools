import "dart:async";

import "package:flutter/widgets.dart";

import "json_cache.dart";

/// data-layer 4.4: how a home screen loads — the saved copy first (painted at
/// once), the server's answer behind it.
///
/// * [peek] reads the saved copy; [fetch] asks the server (and saves on 200).
/// * [onCached] runs only when there is a saved copy AND the server has not
///   already answered — a fresh answer is never painted over by an old one.
/// * [onFresh] runs with the server's answer.
/// * [onError] runs when the server could not answer. [staleSince] is when the
///   saved copy now on screen was made (null when nothing was painted), so
///   the screen keeps it and says it is old — it never swaps it for an empty
///   "nothing here".
Future<void> loadCachedThenFresh<T>({
  required Future<Cached<T>?> Function() peek,
  required Future<T> Function() fetch,
  required void Function(Cached<T> cached) onCached,
  required void Function(T value) onFresh,
  required void Function(Object error, DateTime? staleSince) onError,
}) async {
  var freshDone = false;
  final fresh = fetch().whenComplete(() => freshDone = true);
  // Swallow here; the error is handled below once the copy is painted.
  unawaited(fresh.then((_) {}, onError: (_) {}));
  Cached<T>? shown;
  try {
    final c = await peek();
    if (c != null && !freshDone) {
      shown = c;
      onCached(c);
    }
  } catch (_) {
    /* a broken copy is just no copy */
  }
  try {
    onFresh(await fresh);
  } catch (e) {
    onError(e, shown?.savedAt);
  }
}

/// When the screen last had the server's answer, and whether that is old
/// enough to ask again when the app comes back to the front.
class RefreshClock {
  RefreshClock({
    this.maxAge = const Duration(minutes: 2),
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  final Duration maxAge;
  final DateTime Function() _now;
  DateTime? _last;

  DateTime? get lastFresh => _last;

  void markFresh() => _last = _now();

  /// True when there has never been an answer, or the last one is at least
  /// [maxAge] old. A school's Masters change (a new class, a feature switched
  /// off) reaches a phone left open within [maxAge] of the next resume.
  bool get isStale => _last == null || _now().difference(_last!) >= maxAge;
}

/// Calls [onResume] each time the app comes back to the front.
class ResumeWatcher with WidgetsBindingObserver {
  ResumeWatcher(this.onResume);

  final VoidCallback onResume;
  bool _attached = false;

  void attach() {
    if (_attached) return;
    WidgetsBinding.instance.addObserver(this);
    _attached = true;
  }

  void detach() {
    if (!_attached) return;
    WidgetsBinding.instance.removeObserver(this);
    _attached = false;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) onResume();
  }
}
