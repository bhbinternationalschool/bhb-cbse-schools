import "dart:async";
import "dart:math" as math;

import "package:flutter/material.dart";
import "package:geolocator/geolocator.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../../core/i18n/locale_controller.dart";

double _distanceM(double lat1, double lng1, double lat2, double lng2) {
  const r = 6371000.0;
  final dLat = (lat2 - lat1) * math.pi / 180;
  final dLng = (lng2 - lng1) * math.pi / 180;
  final a =
      math.sin(dLat / 2) * math.sin(dLat / 2) +
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
        () => _locationError = "Turn on location (GPS) to punch attendance.",
      );
      return;
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      setState(
        () => _locationError =
            "Location permission is needed to confirm you are on campus. Enable it in phone settings.",
      );
      return;
    }
    await _positions?.cancel();
    _positions =
        Geolocator.getPositionStream(
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
      Haptics.warning();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.mockLocationIsOnFakeGps)),
      );
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
      Haptics.success();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            "Punched ${result.kind.toUpperCase()} at ${result.time} — ${result.distanceM} m from campus",
          ),
        ),
      );
      await _load();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.couldNotPunchCheckTheConnection)),
        );
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
        ? _distanceM(
            pos.latitude,
            pos.longitude,
            state.fenceLat,
            state.fenceLng,
          )
        : null;
    final accuracyOk =
        state != null &&
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
            Text(context.l10n.myAttendance, style: AppText.titleMedium),
            if (state != null)
              Text(
                "${state.staffName} · ${state.date}",
                style: AppText.labelMedium.copyWith(color: Color(0xFFB8C0D4)),
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
                            onPressed: _load,
                            child: Text(context.l10n.retry),
                          ),
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
                          style: AppText.labelLargeMuted,
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
                                style: AppText.bodyMediumInk.copyWith(
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
                            style: AppText.labelMedium.copyWith(
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
                  Card(
                    child: Padding(
                      padding: EdgeInsets.all(14),
                      child: Text(
                        context.l10n.selfPunchIsDisabledByThe,
                        style: AppText.bodySmallMuted,
                      ),
                    ),
                  )
                else if (done)
                  Card(
                    child: Padding(
                      padding: EdgeInsets.all(14),
                      child: Text(
                        context.l10n.bothPunchesRecordedForTodayHave,
                        style: AppText.bodySmallMuted,
                      ),
                    ),
                  )
                else
                  FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: nextKind == "in"
                          ? AppColors.success
                          : AppColors.warning,
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
                            style: AppText.titleSmall.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
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
          style: AppText.labelSmall.copyWith(
            color: color,
            fontWeight: FontWeight.w700,
          ),
        ),
        Text(value, style: AppText.titleLargeInk),
      ],
    );
  }
}
