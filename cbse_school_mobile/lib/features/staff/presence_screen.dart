/// Staff presence — consent + start/stop for background location sharing.
/// Mirrors the web card: consent text first, visible status, and honesty
/// about what is collected (latest position + incidents during school
/// timing; no movement trail; stopping during school timing is flagged).
library;

import "dart:async";
import "dart:convert";

import "package:flutter/material.dart";
import "package:geolocator/geolocator.dart";
import "package:http/http.dart" as http;

import "../../core/api/api_client.dart";
import "presence_service.dart";

class PresenceScreen extends StatefulWidget {
  const PresenceScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<PresenceScreen> createState() => _PresenceScreenState();
}

class _PresenceScreenState extends State<PresenceScreen> {
  bool _running = false;
  bool _busy = false;
  String? _error;
  String? _status;
  Map<String, dynamic>? _cfg;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    _running = await presenceServiceRunning();
    try {
      final res = await http.get(Uri.parse("${widget.api.baseUrl}/api/staff-geo/ping"));
      if (res.statusCode == 200) _cfg = jsonDecode(res.body) as Map<String, dynamic>;
    } catch (_) {}
    if (mounted) setState(() {});
  }

  Future<bool> _ensurePermissions() async {
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
      setState(() => _error = "Location permission is required. Allow it in phone Settings → Apps → BHB School.");
      return false;
    }
    // Background needs "Allow all the time" on Android 10+.
    if (perm == LocationPermission.whileInUse) {
      perm = await Geolocator.requestPermission();
    }
    return true;
  }

  Future<void> _consentAndStart() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (!await _ensurePermissions()) return;
      Position pos;
      try {
        pos = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 25)),
        );
      } catch (_) {
        setState(() => _error = "Could not read GPS — move near a window and try again.");
        return;
      }
      // First ping carries consent (the server records it once).
      final res = await widget.api.postJson("/api/staff-geo/ping", {
        "lat": pos.latitude,
        "lng": pos.longitude,
        "accuracyM": pos.accuracy.round(),
        "consent": true,
        "device": "flutter-app",
      });
      if (res["ok"] != true) {
        setState(() => _error = (res["error"] as String?) ?? "Could not start");
        return;
      }
      await startPresenceService(widget.api.baseUrl);
      _running = true;
      _status = res["inside"] == true ? "On premises" : "${res["distanceM"]} m from campus";
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _stop() async {
    await stopPresenceService();
    setState(() => _running = false);
  }

  @override
  Widget build(BuildContext context) {
    final window = (_cfg?["window"] as String?) ?? "school hours";
    final enabled = _cfg?["enabled"] != false;
    return Scaffold(
      appBar: AppBar(title: const Text("School presence")),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.location_on, color: _running ? Colors.green : Colors.grey),
                      const SizedBox(width: 8),
                      Text(_running ? "SHARING LOCATION" : "Not sharing", style: TextStyle(fontWeight: FontWeight.bold, color: _running ? Colors.green : Colors.grey)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text("School timing: $window", style: Theme.of(context).textTheme.bodySmall),
                  if (_status != null) Text("Last: $_status", style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: 12),
                  if (!enabled)
                    const Text("The school has not enabled presence tracking yet.")
                  else if (!_running) ...[
                    const Text(
                      "By starting, you agree that the school receives your phone's location during school timing on working days to confirm presence on campus, and may alert the management when you are off campus or your location is unavailable. Only your latest position and incidents are kept — not a movement trail. You can stop any time (stopping during school timing is flagged).",
                      style: TextStyle(fontSize: 12.5),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      "Android will ask for location access — choose “Allow all the time” so sharing continues with the app closed. A permanent notification shows while sharing.",
                      style: TextStyle(fontSize: 12.5, fontStyle: FontStyle.italic),
                    ),
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed: _busy ? null : _consentAndStart,
                      icon: const Icon(Icons.play_arrow),
                      label: Text(_busy ? "Starting…" : "I agree — start sharing"),
                    ),
                  ] else
                    OutlinedButton.icon(onPressed: _stop, icon: const Icon(Icons.stop), label: const Text("Stop sharing")),
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 12.5)),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
