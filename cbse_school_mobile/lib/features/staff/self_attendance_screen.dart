import "dart:async";
import "dart:math" as math;

import "package:flutter/material.dart";
import "package:geolocator/geolocator.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";

double _distanceM(double lat1, double lng1, double lat2, double lng2) {
  const r = 6371000.0;
  final dLat = (lat2 - lat1) * math.pi / 180;
  final dLng = (lng2 - lng1) * math.pi / 180;
  final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
      math.cos(lat1 * math.pi / 180) *
          math.cos(lat2 * math.pi / 180) *
          math.sin(dLng / 2) *
          math.sin(dLng / 2);
  return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
}

String _distanceLabel(double m) =>
    m < 1000 ? "${m.round()} m" : "${(m / 1000).toStringAsFixed(1)} km";

/// GPS self-punch for staff: live distance to campus, then punch in/out.
/// The server re-validates the geofence — this screen's feedback is a
/// courtesy, not the authority.
class SelfAttendanceScreen extends StatefulWidget {
  const SelfAttendanceScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<SelfAttendanceScreen> createState() => _SelfAttendanceScreenState();
}

class _SelfAttendanceScreenState extends State<SelfAttendanceScreen> {
  PunchState? _state;
  String? _error;
  Position? _position;
  String? _locationError;
  StreamSubscription<Position>? _positions;
  bool _punching = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _positions?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final state = await widget.api.fetchPunchState();
      if (!mounted) return;
      setState(() => _state = state);
      await _startLocation();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = "Could not reach the school server.");
      }
    }
  }

  Future<void> _startLocation() async {
    setState(() => _locationError = null);
    if (!await Geolocator.isLocationServiceEnabled()) {
      setState(
          () => _locationError = "Turn on location (GPS) to punch attendance.");
      return;
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      setState(() => _locationError =
          "Location permission is needed to confirm you are on campus. Enable it in phone settings.");
      return;
    }
    await _positions?.cancel();
    _positions = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.best,
        distanceFilter: 2,
      ),
    ).listen(
      (pos) {
        if (mounted) setState(() => _position = pos);
      },
      onError: (_) {
        if (mounted) {
          setState(() => _locationError = "Could not read GPS. Try again.");
        }
      },
    );
  }

  Future<void> _punch(String kind) async {
    final pos = _position;
    if (pos == null || _punching) return;
    if (pos.isMocked) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text(
              "Mock location is ON (fake-GPS app / developer setting). Disable it — mock punches are rejected and flagged.")));
      return;
    }
    setState(() => _punching = true);
    try {
      final result = await widget.api.punchAttendance(
        kind: kind,
        lat: pos.latitude,
        lng: pos.longitude,
        accuracyM: pos.accuracy,
        mocked: pos.isMocked,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(
          "Punched ${result.kind.toUpperCase()} at ${result.time} — ${result.distanceM} m from campus",
        ),
      ));
      await _load();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text("Could not punch. Check the connection.")));
      }
    } finally {
      if (mounted) setState(() => _punching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = _state;
    final pos = _position;

    final distance = (state != null && pos != null)
        ? _distanceM(pos.latitude, pos.longitude, state.fenceLat, state.fenceLng)
        : null;
    final accuracyOk = state != null &&
        pos != null &&
        (state.maxAccuracyM <= 0 || pos.accuracy <= state.maxAccuracyM);
    final insideFence =
        state != null && distance != null && distance <= state.fenceRadiusM;
    final canPunch = insideFence && accuracyOk && !_punching;

    final today = state?.today;
    final punchedIn = (today?.inTime ?? "").isNotEmpty;
    final punchedOut = (today?.outTime ?? "").isNotEmpty;
    final nextKind = punchedIn ? "out" : "in";
    final done = punchedIn && punchedOut;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text("My attendance", style: TextStyle(fontSize: 16)),
            if (state != null)
              Text(
                "${state.staffName} · ${state.date}",
                style: const TextStyle(fontSize: 11, color: Color(0xFFB8C0D4)),
              ),
          ],
        ),
      ),
      body: state == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator(color: AppColors.primary)
                  : Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(_error!, textAlign: TextAlign.center),
                          const SizedBox(height: 12),
                          FilledButton(
                              onPressed: _load, child: const Text("Retry")),
                        ],
                      ),
                    ),
            )
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        _TimeBox(
                          label: "IN",
                          value: today?.inTime ?? "—",
                          color: AppColors.success,
                        ),
                        const SizedBox(width: 10),
                        _TimeBox(
                          label: "OUT",
                          value: today?.outTime ?? "—",
                          color: AppColors.warning,
                        ),
                        const Spacer(),
                        Text(
                          done
                              ? "Day complete"
                              : punchedIn
                                  ? "On campus"
                                  : "Not punched in",
                          style: const TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(
                              pos == null
                                  ? Icons.gps_not_fixed
                                  : insideFence
                                      ? Icons.where_to_vote
                                      : Icons.fmd_bad_outlined,
                              color: pos == null
                                  ? AppColors.muted
                                  : insideFence
                                      ? AppColors.success
                                      : AppColors.danger,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                _locationError ??
                                    (pos == null || distance == null
                                        ? "Getting your location…"
                                        : insideFence
                                            ? "On campus — ${_distanceLabel(distance)} from the school point"
                                            : "${_distanceLabel(distance)} from campus (limit ${state.fenceRadiusM.round()} m)"),
                                style: const TextStyle(
                                  fontSize: 13,
                                  color: AppColors.ink,
                                  height: 1.35,
                                ),
                              ),
                            ),
                          ],
                        ),
                        if (pos != null) ...[
                          const SizedBox(height: 8),
                          Text(
                            "GPS accuracy ±${pos.accuracy.round()} m${accuracyOk ? "" : " — too vague (need ≤ ${state.maxAccuracyM.round()} m). Move outdoors."}",
                            style: TextStyle(
                              fontSize: 11.5,
                              color: accuracyOk
                                  ? AppColors.muted
                                  : AppColors.danger,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                if (!state.allowSelfPunch)
                  const Card(
                    child: Padding(
                      padding: EdgeInsets.all(14),
                      child: Text(
                        "Self punch is disabled by the school. Use the WhatsApp attendance number instead.",
                        style:
                            TextStyle(fontSize: 12.5, color: AppColors.muted),
                      ),
                    ),
                  )
                else if (done)
                  const Card(
                    child: Padding(
                      padding: EdgeInsets.all(14),
                      child: Text(
                        "Both punches recorded for today. Have a good evening!",
                        style:
                            TextStyle(fontSize: 12.5, color: AppColors.muted),
                      ),
                    ),
                  )
                else
                  FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor:
                          nextKind == "in" ? AppColors.success : AppColors.warning,
                      minimumSize: const Size.fromHeight(52),
                    ),
                    onPressed: canPunch ? () => _punch(nextKind) : null,
                    child: _punching
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(
                            "Punch ${nextKind.toUpperCase()}",
                            style: const TextStyle(
                                fontSize: 15, fontWeight: FontWeight.w700),
                          ),
                  ),
              ],
            ),
    );
  }
}

class _TimeBox extends StatelessWidget {
  const _TimeBox({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 10.5,
            fontWeight: FontWeight.w700,
            color: color,
          ),
        ),
        Text(
          value,
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w700,
            color: AppColors.ink,
          ),
        ),
      ],
    );
  }
}
