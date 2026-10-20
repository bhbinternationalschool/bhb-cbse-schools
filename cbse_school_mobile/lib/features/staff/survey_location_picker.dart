import "package:flutter/material.dart";
import "package:flutter_map/flutter_map.dart";
import "package:geolocator/geolocator.dart";
import "package:latlong2/latlong.dart";

import "../../core/theme/app_theme.dart";

/// Where a family lives, for a family recorded WITHOUT a survey day
/// (director, 15 Oct 2026): tap the map to place the pin on their home, or
/// take the phone's location and move the pin if it is off. The app has no
/// Google Maps SDK; this is the OpenStreetMap map the app already uses for
/// the pickup pin (flutter_map). The office gets the point as a Google Maps
/// link on the lead.
///
/// Returns the point, or null when the surveyor backs out.
typedef SurveyPoint = ({double lat, double lng, double accuracyM, String source});

class SurveyLocationPicker extends StatefulWidget {
  const SurveyLocationPicker({
    super.key,
    this.initial,
    this.showTiles = true,
    this.locate,
  });

  final SurveyPoint? initial;

  /// Off in widget tests (no network there).
  final bool showTiles;

  /// The phone's location; injectable for tests.
  final Future<SurveyPoint> Function()? locate;

  @override
  State<SurveyLocationPicker> createState() => _SurveyLocationPickerState();
}

/// The school (Varanasi) — where the map opens before anything is chosen.
const _school = LatLng(25.3176, 82.9739);

class _SurveyLocationPickerState extends State<SurveyLocationPicker> {
  final _map = MapController();
  LatLng? _pin;
  double _accuracy = 0;
  String _source = "map";
  bool _locating = false;
  String _error = "";

  @override
  void initState() {
    super.initState();
    final i = widget.initial;
    if (i != null) {
      _pin = LatLng(i.lat, i.lng);
      _accuracy = i.accuracyM;
      _source = i.source;
    }
  }

  Future<SurveyPoint> _phoneLocation() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw "Turn on the phone's location (GPS), or tap the map to place the pin.";
    }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
      throw "Location permission was not given — tap the map to place the pin.";
    }
    final pos = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 20)),
    );
    return (lat: pos.latitude, lng: pos.longitude, accuracyM: pos.accuracy, source: "gps");
  }

  Future<void> _useMine() async {
    setState(() {
      _locating = true;
      _error = "";
    });
    try {
      final p = await (widget.locate ?? _phoneLocation)();
      if (!mounted) return;
      final here = LatLng(p.lat, p.lng);
      setState(() {
        _pin = here;
        _accuracy = p.accuracyM;
        _source = "gps";
      });
      try {
        _map.move(here, 17);
      } catch (_) {
        /* map not laid out yet */
      }
    } catch (e) {
      if (mounted) setState(() => _error = e is String ? e : "Could not read the location — tap the map to place the pin.");
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pin = _pin;
    return Scaffold(
      appBar: AppBar(title: const Text("Family's home · घर की जगह")),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: Text(
              pin == null
                  ? "Tap the map on the family's home, or use your location."
                  : "${_source == "gps" ? "Your location" : "Pin"}: ${pin.latitude.toStringAsFixed(5)}, ${pin.longitude.toStringAsFixed(5)}"
                        "${_source == "gps" && _accuracy > 0 ? " (±${_accuracy.round()} m)" : ""} — tap the map to move it.",
              style: AppText.bodyMediumInk,
            ),
          ),
          if (_error.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(_error, style: AppText.bodySmall.copyWith(color: AppColors.danger)),
            ),
          Expanded(
            child: FlutterMap(
              key: const Key("survey-location-map"),
              mapController: _map,
              options: MapOptions(
                initialCenter: pin ?? _school,
                initialZoom: pin != null ? 16 : 13,
                onTap: (_, ll) => setState(() {
                  _pin = ll;
                  _source = "map";
                  _accuracy = 0;
                }),
              ),
              children: [
                if (widget.showTiles)
                  TileLayer(
                    urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                    userAgentPackageName: "school.bhbinternational.staff",
                    maxZoom: 19,
                  ),
                if (pin != null)
                  MarkerLayer(
                    markers: [
                      Marker(
                        point: pin,
                        width: 44,
                        height: 44,
                        alignment: Alignment.topCenter,
                        child: const Icon(Icons.location_pin, size: 44, color: Color(0xFFC62828)),
                      ),
                    ],
                  ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.my_location),
                      onPressed: _locating ? null : _useMine,
                      label: Text(_locating ? "Locating…" : "Use my location"),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton(
                      onPressed: pin == null
                          ? null
                          : () => Navigator.of(context).pop<SurveyPoint>(
                              (lat: pin.latitude, lng: pin.longitude, accuracyM: _accuracy, source: _source),
                            ),
                      child: const Text("Use this place"),
                    ),
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
