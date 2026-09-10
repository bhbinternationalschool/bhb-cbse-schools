import "dart:async";
import "dart:math" as math;

import "package:flutter/material.dart";
import "package:flutter_map/flutter_map.dart";
import "package:latlong2/latlong.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";

/// One child's bus on a real map: the route as a line through its stops,
/// the school, the child's own stop, and the bus where the tracker last
/// reported it — refreshed every fifteen seconds while the screen is open.
///
/// The server decides what may be shown: a position only during the
/// transport day and only while the tracker is reporting; a vehicle with no
/// tracker is said to have none. This screen never invents a position, and
/// says how old the one it shows is.
class BusLiveMapScreen extends StatefulWidget {
  const BusLiveMapScreen({super.key, required this.api, required this.studentId, required this.childName});
  final ApiClient api;
  final String studentId;
  final String childName;

  @override
  State<BusLiveMapScreen> createState() => _BusLiveMapScreenState();
}

class _BusLiveMapScreenState extends State<BusLiveMapScreen> {
  final _map = MapController();
  Timer? _timer;
  ChildBusLive? _live;
  String? _error;
  bool _loading = true;
  bool _fitted = false;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 15), (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final all = await widget.api.fetchBusLive();
      final mine = all.children.where((c) => c.studentId == widget.studentId).toList();
      if (!mounted) return;
      setState(() {
        _live = mine.isEmpty ? null : mine.first;
        _error = mine.isEmpty ? "No bus is assigned to ${widget.childName}." : null;
        _loading = false;
      });
      _fitOnce();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = "Could not load the bus position. Pull down to retry.";
        _loading = false;
      });
    }
  }

  void _fitOnce() {
    final l = _live;
    if (_fitted || l == null) return;
    final pts = <LatLng>[
      LatLng(l.school.lat, l.school.lng),
      ...l.path.map((p) => LatLng(p.lat, p.lng)),
      if (l.stop != null) LatLng(l.stop!.lat, l.stop!.lng),
      if (l.bus != null) LatLng(l.bus!.lat, l.bus!.lng),
    ].where((p) => p.latitude != 0 && p.longitude != 0).toList();
    if (pts.length < 2) return;
    _fitted = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _map.fitCamera(CameraFit.bounds(bounds: LatLngBounds.fromPoints(pts), padding: const EdgeInsets.all(48)));
    });
  }

  @override
  Widget build(BuildContext context) {
    final l = _live;
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(l == null ? "Bus location" : "${l.busNo.isEmpty ? l.routeName : l.busNo} · ${widget.childName}"),
        actions: [
          IconButton(tooltip: "Refresh", onPressed: _load, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : l == null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error ?? "", textAlign: TextAlign.center)))
              : Column(
                  children: [
                    _StatusBar(live: l),
                    Expanded(
                      child: FlutterMap(
                        mapController: _map,
                        options: MapOptions(
                          initialCenter: LatLng(l.school.lat == 0 ? 25.4354 : l.school.lat, l.school.lng == 0 ? 82.9440 : l.school.lng),
                          initialZoom: 13,
                          interactionOptions: const InteractionOptions(flags: InteractiveFlag.all & ~InteractiveFlag.rotate),
                        ),
                        children: [
                          TileLayer(
                            urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                            userAgentPackageName: "school.bhbinternational.parent",
                            maxZoom: 19,
                          ),
                          if (l.path.length >= 2)
                            PolylineLayer(
                              polylines: [
                                Polyline(
                                  points: [LatLng(l.school.lat, l.school.lng), ...l.path.map((p) => LatLng(p.lat, p.lng))],
                                  color: theme.colorScheme.primary.withValues(alpha: 0.55),
                                  strokeWidth: 4,
                                ),
                              ],
                            ),
                          MarkerLayer(
                            markers: [
                              for (final p in l.path)
                                Marker(
                                  point: LatLng(p.lat, p.lng),
                                  width: 14,
                                  height: 14,
                                  child: Container(
                                    decoration: BoxDecoration(
                                      color: Colors.white,
                                      shape: BoxShape.circle,
                                      border: Border.all(color: theme.colorScheme.primary, width: 2),
                                    ),
                                  ),
                                ),
                              Marker(
                                point: LatLng(l.school.lat, l.school.lng),
                                width: 40,
                                height: 40,
                                child: const _Pin(icon: Icons.school, color: Color(0xFF203050)),
                              ),
                              if (l.stop != null)
                                Marker(
                                  point: LatLng(l.stop!.lat, l.stop!.lng),
                                  width: 40,
                                  height: 40,
                                  child: const _Pin(icon: Icons.home, color: Color(0xFF1F7A4D)),
                                ),
                              if (l.bus != null)
                                Marker(
                                  point: LatLng(l.bus!.lat, l.bus!.lng),
                                  width: 48,
                                  height: 48,
                                  child: Transform.rotate(
                                    angle: ((l.bus!.courseDeg ?? 0) * math.pi / 180),
                                    child: _Pin(
                                      icon: Icons.directions_bus,
                                      color: l.bus!.freshness == "live" ? const Color(0xFFB42318) : const Color(0xFFC5A028),
                                      size: 48,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                          const RichAttributionWidget(
                            attributions: [TextSourceAttribution("© OpenStreetMap contributors")],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
      floatingActionButton: l?.bus == null
          ? null
          : FloatingActionButton.small(
              tooltip: "Centre on the bus",
              onPressed: () => _map.move(LatLng(l!.bus!.lat, l.bus!.lng), 15),
              child: const Icon(Icons.my_location),
            ),
    );
  }
}

class _StatusBar extends StatelessWidget {
  const _StatusBar({required this.live});
  final ChildBusLive live;

  @override
  Widget build(BuildContext context) {
    final b = live.bus;
    String headline;
    String sub;
    Color tone;
    if (!live.tracked) {
      headline = "This vehicle has no GPS tracker";
      sub = "${live.vehicleName.isEmpty ? live.routeName : live.vehicleName} · live location is not available. Call the driver from the Transport page.";
      tone = AppColors.muted;
    } else if (live.phase == "off") {
      headline = "Bus is not on a school trip now";
      sub = "Live location shows during the transport day (06:00–17:30, Mon–Sat).";
      tone = AppColors.muted;
    } else if (b == null) {
      headline = "Tracker not reporting right now";
      sub = "Last position is older than 15 minutes, so it is not shown. Refreshes every 15 seconds.";
      tone = const Color(0xFFC5A028);
    } else {
      final age = b.ageSec < 60 ? "${b.ageSec}s ago" : "${(b.ageSec / 60).round()} min ago";
      headline = live.etaMinutes != null
          ? "About ${live.etaMinutes} min to ${live.stop?.name ?? "your stop"}"
          : "Bus is on the road";
      sub = "${live.phase == "morning" ? "Morning pickup" : "Afternoon drop"} · updated $age"
          "${b.speedKmh != null ? " · ${b.speedKmh!.round()} km/h" : ""}"
          "${live.distanceKm != null ? " · ${live.distanceKm} km away" : ""}"
          " · estimate, not a promise";
      tone = b.freshness == "live" ? const Color(0xFF1F7A4D) : const Color(0xFFC5A028);
    }
    return Material(
      color: tone.withValues(alpha: 0.08),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Row(
          children: [
            Icon(live.tracked ? Icons.gps_fixed : Icons.gps_off, color: tone),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(headline, style: TextStyle(fontWeight: FontWeight.w700, color: tone)),
                  Padding(padding: const EdgeInsets.only(top: 2), child: Text(sub, style: Theme.of(context).textTheme.bodySmall)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Pin extends StatelessWidget {
  const _Pin({required this.icon, required this.color, this.size = 40});
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
        boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 6, offset: Offset(0, 2))],
      ),
      child: Icon(icon, color: color, size: size * 0.6),
    );
  }
}
