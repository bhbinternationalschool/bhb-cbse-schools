import "dart:async";

import "package:flutter/material.dart";
import "package:geolocator/geolocator.dart";

import "../../core/api/api_client.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";

/// One run's list — the riders in the order the bus reaches their stops
/// (reversed for a drop) — with a button per mark. The same record the web
/// ERP's Bus register writes (/api/v1/transport/register/mark).
///
/// One tap = one request, saved on its own. A tap that does not reach the
/// server stays on the screen as "not saved" and is retried while the
/// screen is open; the server keeps the newest tap, so a late retry can never
/// overwrite a newer one. Tapping the chosen mark again clears it.
///
/// Names are large on purpose: this is read at arm's length in a moving bus.
class BusRunScreen extends StatefulWidget {
  const BusRunScreen({
    super.key,
    required this.api,
    required this.date,
    required this.routeId,
    required this.trip,
    required this.shiftId,
    required this.title,
  });

  final ApiClient api;
  final String date;
  final String routeId;
  final String trip;
  final String shiftId;
  final String title;

  @override
  State<BusRunScreen> createState() => _BusRunScreenState();
}

/// A tap waiting for, or refused by, the server.
class _Pending {
  _Pending({
    required this.status,
    required this.clientRef,
    required this.tappedAt,
  });

  /// boarded / not_boarded / dropped, or "unmarked" (undo).
  final String status;
  final String clientRef;
  final String tappedAt;
  String state = "saving"; // saving | failed
  bool retryable = true;
  String error = "";
}

class _BusRunScreenState extends State<BusRunScreen> {
  RegisterRunView? _view;
  String? _error;
  bool _loading = true;

  /// Saved marks as the server last said (studentId → status / null).
  final Map<String, String?> _saved = {};
  final Map<String, _Pending> _pending = {};
  final Set<String> _inFlight = {};
  Timer? _retry;
  bool _locationAllowed = false;

  @override
  void initState() {
    super.initState();
    _load();
    _warmLocation();
    _retry = Timer.periodic(const Duration(seconds: 12), (_) => _retryFailed());
  }

  @override
  void dispose() {
    _retry?.cancel();
    super.dispose();
  }

  /// The pin is optional on the register — a tap never waits for GPS. Ask
  /// once, then each tap sends the phone's last fix when it has one.
  Future<void> _warmLocation() async {
    try {
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      _locationAllowed =
          perm == LocationPermission.always ||
          perm == LocationPermission.whileInUse;
      if (_locationAllowed) {
        unawaited(
          Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              timeLimit: Duration(seconds: 20),
            ),
          ).then((_) {}, onError: (_) {}),
        );
      }
    } catch (_) {
      _locationAllowed = false;
    }
  }

  Future<Position?> _lastFix() async {
    if (!_locationAllowed) return null;
    try {
      final p = await Geolocator.getLastKnownPosition();
      if (p == null) return null;
      // A fix older than ten minutes says where the bus was, not where it is.
      final age = DateTime.now().difference(p.timestamp);
      return age.inMinutes > 10 ? null : p;
    } catch (_) {
      return null;
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final v = await widget.api.fetchRegisterRun(
        date: widget.date,
        routeId: widget.routeId,
        trip: widget.trip,
        shiftId: widget.shiftId,
      );
      if (!mounted) return;
      setState(() {
        _view = v;
        _saved
          ..clear()
          ..addEntries(v.riders.map((r) => MapEntry(r.studentId, r.status)));
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = "List not loaded — check the internet. सूची नहीं मिली।";
        _loading = false;
      });
    }
  }

  /// What the screen shows for a child: the newest tap, else the saved mark.
  String? _shown(String studentId) {
    final p = _pending[studentId];
    if (p != null) return p.status == "unmarked" ? null : p.status;
    return _saved[studentId];
  }

  void _tap(RegisterRider r, String status) {
    final view = _view;
    if (view == null || !view.editable) return;
    Haptics.tap();
    final next = _shown(r.studentId) == status ? "unmarked" : status;
    final p = _Pending(
      status: next,
      clientRef: transportClientId("tap"),
      tappedAt: DateTime.now().toUtc().toIso8601String(),
    );
    setState(() => _pending[r.studentId] = p);
    _send(r.studentId, p);
  }

  Future<void> _send(String studentId, _Pending p) async {
    if (_inFlight.contains(p.clientRef)) return;
    _inFlight.add(p.clientRef);
    if (mounted) setState(() => p.state = "saving");
    try {
      final fix = await _lastFix();
      final res = await widget.api.markRegister(
        date: widget.date,
        routeId: widget.routeId,
        trip: widget.trip,
        shiftId: widget.shiftId,
        studentId: studentId,
        status: p.status,
        tappedAt: p.tappedAt,
        clientRef: p.clientRef,
        lat: fix?.latitude,
        lng: fix?.longitude,
        accuracyM: fix?.accuracy,
      );
      if (!mounted) return;
      setState(() {
        _saved[studentId] = res.status;
        // A newer tap may have been queued while this one was in flight.
        if (_pending[studentId]?.clientRef == p.clientRef) {
          _pending.remove(studentId);
        }
      });
    } on ApiException catch (e) {
      final code = e.statusCode ?? 0;
      // A refusal (not your bus, day closed, not a rider) will not change on
      // a retry; a server or network hiccup will.
      final retryable = code == 0 || code >= 500 || code == 408 || code == 429;
      if (!mounted) return;
      setState(() {
        p.state = "failed";
        p.retryable = retryable;
        p.error = e.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        p.state = "failed";
        p.retryable = true;
        p.error = "No connection";
      });
    } finally {
      _inFlight.remove(p.clientRef);
    }
  }

  void _retryFailed() {
    for (final e in _pending.entries.toList()) {
      if (e.value.state == "failed" && e.value.retryable) _send(e.key, e.value);
    }
  }

  void _dropRefused(String studentId) =>
      setState(() => _pending.remove(studentId));

  ({int boarded, int dropped, int notBoarded, int unmarked}) _counts(
    RegisterRunView v,
  ) {
    var b = 0, d = 0, n = 0, u = 0;
    for (final r in v.riders) {
      switch (_shown(r.studentId)) {
        case "boarded":
          b++;
        case "dropped":
          d++;
        case "not_boarded":
          n++;
        default:
          u++;
      }
    }
    return (boarded: b, dropped: d, notBoarded: n, unmarked: u);
  }

  @override
  Widget build(BuildContext context) {
    final v = _view;
    final c = v == null ? null : _counts(v);
    final failed = _pending.values.where((p) => p.state == "failed").toList();
    final unsaved = _pending.values.where((p) => p.retryable).length;
    return PopScope(
      // Leaving drops the retry: say how many taps would be lost first.
      canPop: unsaved == 0,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final leave = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: Text("$unsaved tap(s) not saved yet"),
            content: const Text(
              "They are still being sent. Leave now and they will be lost. "
              "अभी निकलेंगे तो ये दर्ज नहीं होंगे।",
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text("Leave"),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text("Stay"),
              ),
            ],
          ),
        );
        if (leave == true && context.mounted) {
          setState(() => _pending.clear());
          Navigator.of(context).pop();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            widget.title,
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
          actions: [
            const ScreenGuideButton(guideId: "bus-run", screenLabel: "Bus run"),
            IconButton(
              onPressed: _load,
              icon: const Icon(Icons.refresh),
              tooltip: "Refresh",
            ),
          ],
        ),
        body: _loading && v == null
            ? const Center(child: CircularProgressIndicator())
            : v == null
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        _error ?? "",
                        textAlign: TextAlign.center,
                        style: AppText.titleMedium,
                      ),
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: _load,
                        child: const Text("Try again · दोबारा"),
                      ),
                    ],
                  ),
                ),
              )
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.only(bottom: 24),
                  children: [
                    Container(
                      color: AppColors.primary,
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            [
                              widget.trip == "AM"
                                  ? "Morning pick-up · सुबह — लेना"
                                  : "Afternoon drop · दोपहर — छोड़ना",
                              if (v.run.name.isNotEmpty) v.run.name,
                              if (v.run.departTime.isNotEmpty) v.run.departTime,
                            ].join(" · "),
                            style: AppText.bodyMedium.copyWith(
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            "${v.riders.length - c!.unmarked} / ${v.riders.length} "
                            "marked · दर्ज",
                            style: AppText.headlineSmall.copyWith(
                              color: Colors.white,
                            ),
                          ),
                          Text(
                            [
                              "Boarded ${c.boarded}",
                              if (widget.trip == "PM") "Dropped ${c.dropped}",
                              "Not boarded ${c.notBoarded}",
                              "Not marked ${c.unmarked}",
                            ].join(" · "),
                            style: AppText.bodySmall.copyWith(
                              color: const Color(0xFFD4D9E6),
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (!v.editable)
                      const _Banner(
                        text:
                            "This day is closed for changes from your phone — "
                            "ask the office. इस दिन को अब फ़ोन से नहीं बदल सकते।",
                        color: AppColors.warning,
                      ),
                    if (!v.classesKnown)
                      const _Banner(
                        text:
                            "The class list could not be read, so every rider "
                            "of the route is listed.",
                        color: AppColors.warning,
                      ),
                    if (failed.isNotEmpty)
                      _Banner(
                        text: failed.any((p) => !p.retryable)
                            ? "Some taps were refused: "
                                  "${failed.firstWhere((p) => !p.retryable).error}"
                            : "${failed.length} tap(s) not saved yet — retrying. "
                                  "इंटरनेट देखें।",
                        color: AppColors.danger,
                      ),
                    if (v.riders.isEmpty)
                      const Padding(
                        padding: EdgeInsets.all(24),
                        child: Text(
                          "No riders on this run. · इस फेरे में कोई बच्चा नहीं।",
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ..._stopGroups(v),
                  ],
                ),
              ),
      ),
    );
  }

  /// Riders under their stop, in the order the server gave.
  List<Widget> _stopGroups(RegisterRunView v) {
    final out = <Widget>[];
    String? lastStop;
    var n = 0;
    for (final r in v.riders) {
      final stopKey = r.stopName.isEmpty ? "\u0000${r.stopId}" : r.stopId;
      if (stopKey != lastStop) {
        lastStop = stopKey;
        n++;
        out.add(
          Container(
            margin: const EdgeInsets.only(top: 10),
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            child: Row(
              children: [
                CircleAvatar(radius: 13, child: Text("$n")),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    r.stopName.isEmpty
                        ? "Stop not found — tell the office"
                        : r.stopName,
                    style: AppText.titleMedium.copyWith(
                      color: r.stopName.isEmpty ? AppColors.danger : null,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      }
      out.add(_riderRow(v, r));
    }
    return out;
  }

  Widget _riderRow(RegisterRunView v, RegisterRider r) {
    final shown = _shown(r.studentId);
    final p = _pending[r.studentId];
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // The name stays exactly as the school recorded it.
          Text(
            r.fullName.isEmpty ? r.studentId : r.fullName,
            style: AppText.headlineSmall.copyWith(
              decoration: shown == "not_boarded"
                  ? TextDecoration.lineThrough
                  : null,
            ),
          ),
          Text(
            [
              if (r.admissionNo.isNotEmpty) r.admissionNo,
              if (r.className.isNotEmpty) r.className,
            ].join(" · "),
            style: AppText.bodySmallMuted,
          ),
          if (r.shiftUnresolved)
            Text(
              "Run not worked out${r.shiftNote.isEmpty ? "" : ": ${r.shiftNote}"}",
              style: AppText.labelMedium.copyWith(color: AppColors.warning),
            ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              for (final s in v.statuses)
                _MarkButton(
                  label: kRegisterStatusLabel[s] ?? s,
                  selected: shown == s,
                  color: s == "not_boarded"
                      ? AppColors.danger
                      : s == "dropped"
                      ? AppColors.info
                      : AppColors.success,
                  onTap: v.editable ? () => _tap(r, s) : null,
                ),
            ],
          ),
          if (p != null && p.state == "saving")
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text("Saving…", style: AppText.labelMediumMuted),
            )
          else if (p != null && p.state == "failed")
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      p.retryable
                          ? "Not saved — retrying. · दर्ज नहीं हुआ"
                          : "Refused: ${p.error}",
                      style: AppText.labelMedium.copyWith(
                        color: AppColors.danger,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: p.retryable
                        ? () => _send(r.studentId, p)
                        : () => _dropRefused(r.studentId),
                    child: Text(p.retryable ? "Retry" : "OK"),
                  ),
                ],
              ),
            )
          else if (shown != null && r.markedByName.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                "by ${r.markedByName}",
                style: AppText.labelMediumMuted,
              ),
            ),
          const Divider(height: 18),
        ],
      ),
    );
  }
}

class _MarkButton extends StatelessWidget {
  const _MarkButton({
    required this.label,
    required this.selected,
    required this.color,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final Color color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final text = Text(
      label,
      style: AppText.titleSmall.copyWith(fontWeight: FontWeight.w700),
    );
    return selected
        ? FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: color,
              minimumSize: const Size(0, 48),
            ),
            onPressed: onTap,
            icon: const Icon(Icons.check, size: 18),
            label: text,
          )
        : OutlinedButton(
            style: OutlinedButton.styleFrom(
              foregroundColor: color,
              minimumSize: const Size(0, 48),
            ),
            onPressed: onTap,
            child: text,
          );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    margin: const EdgeInsets.fromLTRB(12, 10, 12, 0),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: color.withValues(alpha: 0.3)),
    ),
    child: Text(text, style: AppText.bodyMedium.copyWith(color: color)),
  );
}
