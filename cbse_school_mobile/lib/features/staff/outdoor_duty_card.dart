import "package:flutter/material.dart";
import "package:geolocator/geolocator.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart" show formatDateLabel;

/// The text of the leadership FYI after a check-out — word for word what
/// the web sends (components/staff/StaffBroadcastButton submitOutdoorStart).
String outdoorStartMessage({
  required String name,
  required String purpose,
  required String destination,
  String note = "",
  bool gps = false,
}) =>
    "$name checked out for outdoor duty — ${outdoorPurposeLabel(purpose)} · $destination."
    "${note.trim().isNotEmpty ? " ${note.trim()}" : ""}"
    "${gps ? " (GPS captured)" : ""}";

/// …and after the check-in (submitOutdoorEnd).
String outdoorEndMessage({
  required String name,
  required String purpose,
  required String destination,
}) =>
    "$name checked back in from outdoor duty (${outdoorPurposeLabel(purpose)} · $destination).";

/// "09:40" from the server's ISO time, in the phone's local time.
String _clock(String iso) {
  final t = DateTime.tryParse(iso)?.toLocal();
  if (t == null) return "";
  return "${t.hour.toString().padLeft(2, "0")}:${t.minute.toString().padLeft(2, "0")}";
}

/// Outdoor duty on the self-attendance screen: check out for official work
/// off campus (bank, inspection, errand…) and check back in.
///
/// The same route the web uses (POST /api/v1/staff/attendance/outdoor). It
/// is NOT a signed punch: the server takes the session's own staff record,
/// needs a destination, and records the location when the phone sends one
/// (optional, as on the web). The day counts as present with an
/// "Outdoor duty" note. After it is filed, leadership gets the same short
/// FYI the web sends; that is best effort.
class OutdoorDutyCard extends StatefulWidget {
  const OutdoorDutyCard({
    super.key,
    required this.api,
    required this.staffName,
    required this.position,
    this.onChanged,
  });

  final ApiClient api;
  final String staffName;

  /// The screen's live GPS fix, if it has one.
  final Position? position;

  /// Called after a check-out / check-in so the screen can reload the day.
  final VoidCallback? onChanged;

  @override
  State<OutdoorDutyCard> createState() => _OutdoorDutyCardState();
}

class _OutdoorDutyCardState extends State<OutdoorDutyCard> {
  bool _loading = true;
  String? _loadError;
  OutdoorDutySession? _active;
  bool _busy = false;
  String _purpose = "official_errand";
  final _destination = TextEditingController();
  final _note = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _destination.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final a = await widget.api.fetchOutdoorDuty();
      if (mounted) setState(() => _active = a);
    } on ApiException catch (e) {
      if (mounted) setState(() => _loadError = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _loadError = "Could not reach the school server.");
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// The screen's fix, else one quick read; null when there is none (the
  /// server accepts that, and the message says so).
  Future<Position?> _fix() async {
    final p = widget.position;
    if (p != null) return p;
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return null;
      final perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied ||
          perm == LocationPermission.deniedForever) {
        return null;
      }
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 10),
        ),
      );
    } catch (_) {
      return null;
    }
  }

  void _say(String text) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _start() async {
    final dest = _destination.text.trim();
    if (dest.isEmpty) {
      Haptics.warning();
      _say("Write where you are going · कहाँ जा रहे हैं, लिखें");
      return;
    }
    setState(() => _busy = true);
    try {
      final pos = await _fix();
      if (pos != null && pos.isMocked) {
        Haptics.warning();
        _say("Mock location is ON — turn off the fake-GPS app.");
        return;
      }
      final s = await widget.api.startOutdoorDuty(
        purpose: _purpose,
        destination: dest,
        note: _note.text.trim(),
        lat: pos?.latitude,
        lng: pos?.longitude,
        accuracyM: pos?.accuracy,
      );
      if (!mounted) return;
      setState(() {
        _active = s;
        _destination.clear();
        _note.clear();
      });
      Haptics.success();
      _say(
        "Checked out for ${outdoorPurposeLabel(s.purpose)} at ${s.destination}"
        "${pos != null ? " — location recorded" : " — location unavailable"}.",
      );
      widget.onChanged?.call();
      await widget.api.pingLeadership(
        outdoorStartMessage(
          name: widget.staffName,
          purpose: s.purpose,
          destination: s.destination,
          note: s.note,
          gps: pos != null,
        ),
      );
    } on ApiException catch (e) {
      if (mounted) _say(e.message);
    } catch (_) {
      if (mounted) {
        _say("Outdoor duty was NOT saved — could not reach the school server.");
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _end() async {
    final a = _active;
    if (a == null) return;
    setState(() => _busy = true);
    try {
      final pos = await _fix();
      if (pos != null && pos.isMocked) {
        Haptics.warning();
        _say("Mock location is ON — turn off the fake-GPS app.");
        return;
      }
      await widget.api.endOutdoorDuty(
        sessionId: a.id,
        lat: pos?.latitude,
        lng: pos?.longitude,
        accuracyM: pos?.accuracy,
      );
      if (!mounted) return;
      setState(() => _active = null);
      Haptics.success();
      _say("Checked in — outdoor duty closed.");
      widget.onChanged?.call();
      await widget.api.pingLeadership(
        outdoorEndMessage(
          name: widget.staffName,
          purpose: a.purpose,
          destination: a.destination,
        ),
      );
    } on ApiException catch (e) {
      if (mounted) _say(e.message);
    } catch (_) {
      if (mounted) {
        _say("Check-in was NOT saved — could not reach the school server.");
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tone = ModuleTone.purple;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(Icons.directions_walk_outlined, color: tone.foreground),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    "Outdoor duty · बाहर की ड्यूटी",
                    style: AppText.titleSmallInk.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              "Going out for school work (bank, inspection, errand)? Check out here and check back in when you return — the day counts as present.",
              style: AppText.bodySmallMuted,
            ),
            const SizedBox(height: 12),
            if (_loading)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(8),
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              )
            else if (_loadError != null) ...[
              // Unknown is not "no duty": no check-out form until we know.
              Text(_loadError!, style: AppText.bodySmall),
              const SizedBox(height: 8),
              OutlinedButton(onPressed: _load, child: const Text("Retry")),
            ] else if (_active != null)
              _activeView(_active!, tone)
            else
              _startForm(tone),
          ],
        ),
      ),
    );
  }

  Widget _activeView(OutdoorDutySession a, ModuleTone tone) {
    final since = _clock(a.startedAt);
    final day = a.startedAt.length >= 10 ? a.startedAt.substring(0, 10) : "";
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: tone.background,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            "Out on ${outdoorPurposeLabel(a.purpose)} · ${a.destination}"
            "${since.isNotEmpty ? "\nSince $since${day.isNotEmpty ? " · ${formatDateLabel(day)}" : ""}" : ""}"
            "${a.note.isNotEmpty ? "\n${a.note}" : ""}",
            style: AppText.bodyMediumInk.copyWith(height: 1.35),
          ),
        ),
        const SizedBox(height: 10),
        FilledButton.icon(
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.success,
            minimumSize: const Size.fromHeight(48),
          ),
          onPressed: _busy ? null : _end,
          icon: _busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.login),
          label: const Text("Check in — I'm back · वापस आ गए"),
        ),
      ],
    );
  }

  Widget _startForm(ModuleTone tone) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DropdownButtonFormField<String>(
          initialValue: _purpose,
          decoration: const InputDecoration(
            labelText: "Purpose · काम",
            border: OutlineInputBorder(),
          ),
          items: [
            for (final p in kOutdoorDutyPurposes)
              DropdownMenuItem(value: p.$1, child: Text("${p.$2} · ${p.$3}")),
          ],
          onChanged: _busy
              ? null
              : (v) => setState(() => _purpose = v ?? "official_errand"),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: _destination,
          enabled: !_busy,
          maxLength: 200,
          decoration: const InputDecoration(
            labelText: "Where are you going? · कहाँ जा रहे हैं?",
            border: OutlineInputBorder(),
          ),
        ),
        TextField(
          controller: _note,
          enabled: !_busy,
          maxLength: 500,
          decoration: const InputDecoration(
            labelText: "Note (optional) · नोट",
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 4),
        FilledButton.icon(
          style: FilledButton.styleFrom(
            backgroundColor: tone.foreground,
            minimumSize: const Size.fromHeight(48),
          ),
          onPressed: _busy ? null : _start,
          icon: _busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.logout),
          label: const Text("Check out for outdoor duty · बाहर जाएँ"),
        ),
        const SizedBox(height: 6),
        Text(
          widget.position != null
              ? "Your location is recorded with the check-out."
              : "Your location is recorded when the phone has a GPS fix.",
          style: AppText.labelMediumMuted,
        ),
      ],
    );
  }
}
