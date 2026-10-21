import "dart:async";
import "dart:math" as math;

import "package:flutter/material.dart";
import "package:flutter_map/flutter_map.dart";
import "package:latlong2/latlong.dart";

import "../../core/api/api_client.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "../../l10n/app_localizations.dart";

/// How often the screen asks for the bus while it is on screen.
const kBusRouteLivePoll = Duration(seconds: 15);

/// "07:42" in the phone's own clock.
String liveHhmm(DateTime t) {
  final l = t.toLocal();
  return "${l.hour.toString().padLeft(2, "0")}:${l.minute.toString().padLeft(2, "0")}";
}

/// The line under a stop's name. Never a time the server did not give:
/// a stale fix arrives with no arrival times, and stays that way here.
String liveStopLine(L l, LiveRouteStop s) {
  switch (s.state) {
    case "passed":
      return s.passedAt == null ? "" : l.busLivePassedAt(liveHhmm(s.passedAt!));
    case "not_seen":
      return l.busLiveNotSeen;
    case "unpinned":
      return l.busLiveUnpinned;
    default:
      if (s.etaAt != null && s.etaMinutes != null) {
        return l.busLiveEta(liveHhmm(s.etaAt!), s.etaMinutes.toString());
      }
      return l.busLiveNoEta;
  }
}

/// Whether polling should run in this app lifecycle state: only in the
/// foreground. A phone in a pocket does not need the bus every 15 seconds.
bool livePollAllowed(AppLifecycleState state) =>
    state == AppLifecycleState.resumed;

/// One route, live: the bus moving on the map along its stops, the stops in
/// the order this run visits them, which have been passed (and when), and
/// roughly when the bus reaches each of the rest.
///
/// Polls every 15 s while the screen is visible and the app is in the
/// foreground; stops when backgrounded or covered by another screen.
class BusRouteLiveScreen extends StatefulWidget {
  const BusRouteLiveScreen({
    super.key,
    required this.api,
    required this.routeId,
    required this.title,
  });

  final ApiClient api;
  final String routeId;
  final String title;

  @override
  State<BusRouteLiveScreen> createState() => _BusRouteLiveScreenState();
}

class _BusRouteLiveScreenState extends State<BusRouteLiveScreen>
    with WidgetsBindingObserver, SingleTickerProviderStateMixin {
  final _map = MapController();
  late final AnimationController _move = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1500),
  );
  Timer? _timer;
  BusRoutesLive? _data;
  LiveRouteView? _route;
  String? _error;
  bool _loading = true;
  bool _busy = false;
  bool _fitted = false;
  LatLng? _from;
  LatLng? _to;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    _startPolling();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _move.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (livePollAllowed(state)) {
      _load();
      _startPolling();
    } else {
      _timer?.cancel();
      _timer = null;
    }
  }

  void _startPolling() {
    _timer?.cancel();
    _timer = Timer.periodic(kBusRouteLivePoll, (_) {
      // Covered by another screen: skip this tick, keep the timer.
      if (!mounted || !(ModalRoute.of(context)?.isCurrent ?? true)) return;
      _load();
    });
  }

  Future<void> _load() async {
    if (_busy) return;
    _busy = true;
    try {
      final d = await widget.api.fetchBusRoutesLive(routeId: widget.routeId);
      if (!mounted) return;
      final match = d.routes.where((r) => r.routeId == widget.routeId);
      final r = match.isEmpty ? null : match.first;
      setState(() {
        _data = d;
        _route = r;
        _error = r == null ? context.l10n.busLiveRouteMissing : null;
        _loading = false;
      });
      _moveBus(r?.fix);
      _fitOnce();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        // Keep what was on screen; say the refresh failed.
        _error = context.l10n.busCouldNotLoadPosition;
        _loading = false;
      });
    } finally {
      _busy = false;
    }
  }

  void _moveBus(LiveBusFix? fix) {
    if (fix == null || !fix.hasPoint) {
      _from = _to = null;
      return;
    }
    final next = LatLng(fix.lat, fix.lng);
    final current = _currentBus();
    _from = current ?? next;
    _to = next;
    _move.forward(from: 0);
  }

  LatLng? _currentBus() {
    final f = _from;
    final t = _to;
    if (f == null || t == null) return t;
    final v = Curves.easeInOut.transform(_move.value);
    return LatLng(
      f.latitude + (t.latitude - f.latitude) * v,
      f.longitude + (t.longitude - f.longitude) * v,
    );
  }

  void _fitOnce() {
    final r = _route;
    if (_fitted || r == null) return;
    final pts = <LatLng>[
      for (final s in r.stops)
        if (s.pinned) LatLng(s.lat!, s.lng!),
      if (r.fix != null && r.fix!.hasPoint) LatLng(r.fix!.lat, r.fix!.lng),
    ];
    if (pts.length < 2) return;
    _fitted = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _map.fitCamera(
        CameraFit.bounds(
          bounds: LatLngBounds.fromPoints(pts),
          padding: const EdgeInsets.all(40),
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final r = _route;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          IconButton(
            tooltip: context.l10n.refresh,
            onPressed: _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : r == null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(_error ?? "", textAlign: TextAlign.center),
              ),
            )
          : Column(
              children: [
                _LiveStatus(
                  route: r,
                  staleAfterMinutes: _data?.staleAfterMinutes ?? 10,
                ),
                if (_error != null)
                  Material(
                    color: AppColors.danger.withValues(alpha: 0.08),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 6,
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(_error!, style: AppText.bodySmallMuted),
                          ),
                        ],
                      ),
                    ),
                  ),
                SizedBox(
                  height: MediaQuery.of(context).size.height * 0.38,
                  child: _map0(r),
                ),
                Expanded(child: _stopsList(r)),
              ],
            ),
    );
  }

  Widget _map0(LiveRouteView r) {
    final theme = Theme.of(context);
    final pinned = r.stops.where((s) => s.pinned).toList();
    final schoolLat = _data?.schoolLat;
    final schoolLng = _data?.schoolLng;
    final school = schoolLat != null && schoolLng != null
        ? LatLng(schoolLat, schoolLng)
        : null;
    final centre = r.fix != null && r.fix!.hasPoint
        ? LatLng(r.fix!.lat, r.fix!.lng)
        : pinned.isNotEmpty
        ? LatLng(pinned.first.lat!, pinned.first.lng!)
        : (school ?? const LatLng(25.4354, 82.9440));
    final fresh = r.status == "live";
    return FlutterMap(
      mapController: _map,
      options: MapOptions(
        initialCenter: centre,
        initialZoom: 13,
        interactionOptions: const InteractionOptions(
          flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
        ),
      ),
      children: [
        TileLayer(
          urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          userAgentPackageName: "school.bhbinternational.staff",
          maxZoom: 19,
        ),
        if (pinned.length >= 2)
          PolylineLayer(
            polylines: [
              Polyline(
                points: [for (final s in pinned) LatLng(s.lat!, s.lng!)],
                color: theme.colorScheme.primary.withValues(alpha: 0.55),
                strokeWidth: 4,
              ),
            ],
          ),
        MarkerLayer(
          markers: [
            for (final s in pinned)
              Marker(
                point: LatLng(s.lat!, s.lng!),
                width: 14,
                height: 14,
                child: Container(
                  decoration: BoxDecoration(
                    color: s.state == "passed"
                        ? theme.colorScheme.primary
                        : Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: theme.colorScheme.primary,
                      width: 2,
                    ),
                  ),
                ),
              ),
            if (school != null)
              Marker(
                point: school,
                width: 36,
                height: 36,
                child: const _Pin(icon: Icons.school, color: Color(0xFF203050)),
              ),
          ],
        ),
        AnimatedBuilder(
          animation: _move,
          builder: (context, _) {
            final p = _currentBus();
            if (p == null) return const SizedBox.shrink();
            return MarkerLayer(
              markers: [
                Marker(
                  point: p,
                  width: 46,
                  height: 46,
                  child: Transform.rotate(
                    angle: ((r.fix?.headingDeg ?? 0) * math.pi / 180),
                    child: _Pin(
                      icon: Icons.directions_bus,
                      // Grey when it is only "last seen".
                      color: fresh
                          ? const Color(0xFFB42318)
                          : const Color(0xFF8A8A8A),
                      size: 46,
                    ),
                  ),
                ),
              ],
            );
          },
        ),
        const RichAttributionWidget(
          attributions: [TextSourceAttribution("© OpenStreetMap contributors")],
        ),
      ],
    );
  }

  Widget _stopsList(LiveRouteView r) {
    final l = context.l10n;
    final nextIdx = r.stops.indexWhere(
      (s) => s.state == "upcoming" && s.etaMinutes != null,
    );
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          if (r.status == "live")
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(l.busLiveEstimateNote, style: AppText.bodySmallMuted),
            ),
          for (var i = 0; i < r.stops.length; i++)
            _StopRow(
              stop: r.stops[i],
              line: liveStopLine(l, r.stops[i]),
              isNext: i == nextIdx,
              isLast: i == r.stops.length - 1,
            ),
          if (r.schoolEtaAt != null && r.schoolEtaMinutes != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                l.busLiveSchoolEta(
                  liveHhmm(r.schoolEtaAt!),
                  r.schoolEtaMinutes.toString(),
                ),
                style: AppText.bodyMediumInk.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _LiveStatus extends StatelessWidget {
  const _LiveStatus({required this.route, required this.staleAfterMinutes});
  final LiveRouteView route;
  final int staleAfterMinutes;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final f = route.fix;
    final seen = f?.fixAt == null ? null : liveHhmm(f!.fixAt!);
    String headline;
    String sub;
    Color tone;
    IconData icon = Icons.gps_fixed;
    switch (route.status) {
      case "live":
        headline = l.busLiveOnRun(route.run?.name ?? "");
        final age = (f?.ageSec ?? 0) < 60
            ? l.busSecondsAgo((f?.ageSec ?? 0).toString())
            : l.busMinutesAgo(((f?.ageSec ?? 0) / 60).round().toString());
        sub = [
          if (seen != null) l.busLivePositionAt(seen, age),
          if (f?.speedKmh != null)
            l.busSpeedKmh(f!.speedKmh!.round().toString()),
          if (route.trailUnread) l.busLiveTrailUnread,
        ].join(" · ");
        tone = const Color(0xFF1F7A4D);
      case "stale":
        headline = l.busLiveStale(seen ?? "—");
        sub = [
          l.busLiveStaleDetail(staleAfterMinutes.toString()),
          if (route.run != null) route.run!.name,
        ].join(" · ");
        tone = const Color(0xFFC5A028);
      case "off_shift":
        headline = l.busLiveOffShift;
        sub = seen != null
            ? l.busLiveOffShiftLastSeen(seen)
            : l.busLiveOffShiftNoFix;
        tone = AppColors.muted;
        icon = Icons.schedule;
      case "untracked":
        headline = l.busLiveUntracked;
        sub = l.busLiveUntrackedDetail(
          route.vehicleName.isNotEmpty
              ? route.vehicleName
              : (route.vehicleReg.isNotEmpty ? route.vehicleReg : route.name),
        );
        tone = AppColors.muted;
        icon = Icons.gps_off;
      default:
        headline = l.busLiveNoVehicle;
        sub = "";
        tone = AppColors.muted;
        icon = Icons.gps_off;
    }
    return Material(
      color: tone.withValues(alpha: 0.08),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Row(
          children: [
            Icon(icon, color: tone),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    headline,
                    style: TextStyle(fontWeight: FontWeight.w700, color: tone),
                  ),
                  if (sub.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        sub,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StopRow extends StatelessWidget {
  const _StopRow({
    required this.stop,
    required this.line,
    required this.isNext,
    required this.isLast,
  });
  final LiveRouteStop stop;
  final String line;
  final bool isNext;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final passed = stop.state == "passed";
    final dot = passed
        ? AppColors.success
        : isNext
        ? AppColors.danger
        : stop.state == "upcoming"
        ? AppColors.primaryMid
        : AppColors.muted;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
            ),
            if (!isLast)
              Container(width: 2, height: 34, color: const Color(0xFFD8D6CC)),
          ],
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                stop.name,
                style: AppText.bodyMediumInk.copyWith(
                  fontWeight: isNext ? FontWeight.w700 : FontWeight.w400,
                  color: passed ? AppColors.muted : null,
                ),
              ),
              if (line.isNotEmpty) Text(line, style: AppText.labelMediumMuted),
            ],
          ),
        ),
      ],
    );
  }
}

class _Pin extends StatelessWidget {
  const _Pin({required this.icon, required this.color, this.size = 36});
  final IconData icon;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
        border: Border.all(color: color, width: 2.5),
        boxShadow: const [
          BoxShadow(
            color: Color(0x33000000),
            blurRadius: 6,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Icon(icon, color: color, size: size * 0.6),
    );
  }
}
