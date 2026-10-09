import "package:flutter/material.dart";
import "package:flutter_map/flutter_map.dart";
import "package:geolocator/geolocator.dart";
import "package:latlong2/latlong.dart";

import "../../core/api/api_client.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/theme/app_theme.dart";

/// "Set my pickup point" (director, 9 Oct 2026): the parent puts a pin where
/// their child boards — by the phone's location, or by tapping the map — and
/// it is saved for every child of theirs who rides a school bus.
///
/// The same pin the WhatsApp request collects; 98 of 117 families never
/// answered that. It does not move the child to another stop or route: the
/// office decides that, now able to see a doorstep instead of a village.
///
/// The phone's location is read only when the parent taps "Use my current
/// location", and never in the background.
class PickupPinScreen extends StatefulWidget {
  const PickupPinScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<PickupPinScreen> createState() => _PickupPinScreenState();
}

class _PickupPinScreenState extends State<PickupPinScreen> {
  final _map = MapController();
  Map<String, dynamic>? _data;
  LatLng? _pin;
  double? _accuracy;
  bool _busy = false;
  bool _locating = false;
  String _error = "";
  String _done = "";

  bool get _hi => Localizations.localeOf(context).languageCode == "hi";
  String _t(String en, String hi) => _hi ? hi : en;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await widget.api.fetchPickupPin();
      final pin = d["pin"] as Map<String, dynamic>?;
      if (!mounted) return;
      setState(() {
        _data = d;
        if (pin != null) {
          _pin = LatLng(
            (pin["lat"] as num).toDouble(),
            (pin["lng"] as num).toDouble(),
          );
        }
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = _t(
            "Could not reach the school server.",
            "स्कूल के सर्वर से जुड़ नहीं पाए।",
          ),
        );
      }
    }
  }

  Future<void> _useMyLocation() async {
    setState(() {
      _locating = true;
      _error = "";
    });
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        setState(
          () => _error = _t(
            "Turn on your phone's location (GPS) and try again.",
            "फ़ोन की लोकेशन (GPS) चालू करें और फिर कोशिश करें।",
          ),
        );
        return;
      }
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied ||
          perm == LocationPermission.deniedForever) {
        setState(
          () => _error = _t(
            "Location permission was not given. You can still tap the map to place the pin.",
            "लोकेशन की अनुमति नहीं मिली। आप मैप पर टैप करके भी पिन लगा सकते हैं।",
          ),
        );
        return;
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 20),
        ),
      );
      final here = LatLng(pos.latitude, pos.longitude);
      setState(() {
        _pin = here;
        _accuracy = pos.accuracy;
      });
      _map.move(here, 17);
    } catch (_) {
      setState(
        () => _error = _t(
          "Could not read your location. Tap the map to place the pin instead.",
          "आपकी लोकेशन नहीं मिल पाई। मैप पर टैप करके पिन लगाएँ।",
        ),
      );
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  List<String> get _riderNames => ((_data?["riders"] as List?) ?? const [])
      .map((r) => "${(r as Map)["name"] ?? ""}")
      .where((n) => n.isNotEmpty)
      .toList();

  Future<void> _save() async {
    final pin = _pin;
    if (pin == null || _busy) return;
    final names = _riderNames;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(_t("Save this pickup point?", "यह पिकअप पॉइंट सेव करें?")),
        content: Text(
          names.isEmpty
              ? _t(
                  "It will be saved for your child.",
                  "यह आपके बच्चे के लिए सेव होगा।",
                )
              : _t(
                  "It will be saved for ${names.join(", ")}.",
                  "यह ${names.join(", ")} के लिए सेव होगा।",
                ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(_t("Cancel", "रद्द करें")),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(_t("Save", "सेव करें")),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() {
      _busy = true;
      _error = "";
    });
    try {
      await widget.api.savePickupPin(
        lat: pin.latitude,
        lng: pin.longitude,
        accuracyM: _accuracy,
      );
      if (mounted) {
        setState(
          () => _done = _t(
            "Saved. The transport office will use this point when planning the bus stop.",
            "सेव हो गया। ट्रांसपोर्ट ऑफ़िस बस स्टॉप तय करते समय इसी जगह को देखेगा।",
          ),
        );
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = _t(
            "Not saved — could not reach the school server.",
            "सेव नहीं हुआ — स्कूल के सर्वर से जुड़ नहीं पाए।",
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _notNow() async {
    try {
      await widget.api.declinePickupPin();
    } catch (_) {
      /* closing anyway */
    }
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final school = d?["school"] as Map<String, dynamic>?;
    final schoolLl = school == null
        ? null
        : LatLng(
            (school["lat"] as num).toDouble(),
            (school["lng"] as num).toDouble(),
          );
    final stops = ((d?["stops"] as List?) ?? const [])
        .map((s) => (s as Map<String, dynamic>))
        .map(
          (s) => (
            name: "${s["name"] ?? ""}",
            at: LatLng(
              (s["lat"] as num).toDouble(),
              (s["lng"] as num).toDouble(),
            ),
          ),
        )
        .toList();
    final center =
        _pin ??
        (stops.isNotEmpty ? stops.first.at : schoolLl) ??
        const LatLng(25.3176, 82.9739);

    return Scaffold(
      appBar: AppBar(
        title: Text(_t("Set my pickup point", "मेरा पिकअप पॉइंट")),
        actions: const [
          ScreenGuideButton(guideId: "pickup-pin", screenLabel: "Pickup point"),
        ],
      ),
      body: d == null
          ? Center(
              child: _error.isEmpty
                  ? const CircularProgressIndicator(color: AppColors.primary)
                  : Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(_error, textAlign: TextAlign.center),
                    ),
            )
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                  child: Text(
                    _done.isNotEmpty
                        ? _done
                        : _t(
                            "Tap the map where your child boards the bus, or use your current location. Blue dots are the bus's stops.",
                            "मैप पर उस जगह टैप करें जहाँ बच्चा बस में चढ़ता है, या अपनी अभी की लोकेशन लगाएँ। नीले बिंदु बस के स्टॉप हैं।",
                          ),
                    style: TextStyle(
                      color: _done.isNotEmpty
                          ? AppColors.success
                          : AppColors.ink,
                    ),
                  ),
                ),
                Expanded(
                  child: FlutterMap(
                    mapController: _map,
                    options: MapOptions(
                      initialCenter: center,
                      initialZoom: _pin != null ? 16 : 14,
                      onTap: _done.isNotEmpty
                          ? null
                          : (_, ll) => setState(() {
                              _pin = ll;
                              _accuracy = null;
                            }),
                    ),
                    children: [
                      TileLayer(
                        urlTemplate:
                            "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                        userAgentPackageName: "school.bhbinternational.parent",
                        maxZoom: 19,
                      ),
                      MarkerLayer(
                        markers: [
                          for (final s in stops)
                            Marker(
                              point: s.at,
                              width: 18,
                              height: 18,
                              child: Tooltip(
                                message: s.name,
                                child: Container(
                                  decoration: BoxDecoration(
                                    color: const Color(0xFF1565C0),
                                    shape: BoxShape.circle,
                                    border: Border.all(
                                      color: Colors.white,
                                      width: 2,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          if (schoolLl != null)
                            Marker(
                              point: schoolLl,
                              width: 36,
                              height: 36,
                              child: const Icon(
                                Icons.school,
                                color: AppColors.primary,
                                size: 30,
                              ),
                            ),
                          if (_pin != null)
                            Marker(
                              point: _pin!,
                              width: 44,
                              height: 44,
                              alignment: Alignment.topCenter,
                              child: const Icon(
                                Icons.location_pin,
                                color: AppColors.danger,
                                size: 44,
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                if (_error.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                    child: Text(
                      _error,
                      style: const TextStyle(color: AppColors.danger),
                    ),
                  ),
                SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
                    child: _done.isNotEmpty
                        ? SizedBox(
                            width: double.infinity,
                            child: FilledButton(
                              onPressed: () => Navigator.of(context).pop(),
                              child: Text(_t("Done", "ठीक है")),
                            ),
                          )
                        : Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              SizedBox(
                                width: double.infinity,
                                child: OutlinedButton.icon(
                                  onPressed: _locating ? null : _useMyLocation,
                                  icon: _locating
                                      ? const SizedBox(
                                          width: 16,
                                          height: 16,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                          ),
                                        )
                                      : const Icon(Icons.my_location),
                                  label: Text(
                                    _t(
                                      "Use my current location",
                                      "मेरी अभी की लोकेशन लगाएँ",
                                    ),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 8),
                              SizedBox(
                                width: double.infinity,
                                child: FilledButton(
                                  onPressed: _pin == null || _busy
                                      ? null
                                      : _save,
                                  child: Text(
                                    _t(
                                      "Save pickup point",
                                      "पिकअप पॉइंट सेव करें",
                                    ),
                                  ),
                                ),
                              ),
                              if ((d["pin"]) == null)
                                TextButton(
                                  onPressed: _busy ? null : _notNow,
                                  child: Text(_t("Not now", "अभी नहीं")),
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
