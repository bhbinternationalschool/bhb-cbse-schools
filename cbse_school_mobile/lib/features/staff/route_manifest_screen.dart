import "package:flutter/material.dart";
import "package:geolocator/geolocator.dart";

import "../../core/api/api_client.dart";

/// रूट हाज़िरी — the list a driver or attendant actually works from.
///
/// Written in Hindi because the people using it read Hindi, not because it is
/// a translation exercise. Two things stay as they are: the child's name
/// exactly as the school recorded it, and the admission number. Transliterating
/// a name invents a spelling nobody can match against the register, and the
/// name is the one word on this screen that must be unambiguous.
///
/// Names are set large and bold on purpose. This is read at arm's length, in
/// a moving vehicle, often in poor light.
class RouteManifestScreen extends StatefulWidget {
  const RouteManifestScreen({
    super.key,
    required this.api,
    required this.routeId,
    required this.routeLabel,
  });

  final ApiClient api;
  final String routeId;
  final String routeLabel;

  @override
  State<RouteManifestScreen> createState() => _RouteManifestScreenState();
}

class _RouteManifestScreenState extends State<RouteManifestScreen> {
  Map<String, dynamic>? _data;
  String? _error;
  bool _loading = true;
  String _trip = "AM";
  final Set<String> _busy = {};

  @override
  void initState() {
    super.initState();
    // Before noon the bus is collecting; after, it is dropping. The attendant
    // can still switch, but the common case should need no tap.
    _trip = DateTime.now().hour < 12 ? "AM" : "PM";
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final d = await widget.api.fetchTransportManifest(
        routeId: widget.routeId,
        trip: _trip,
      );
      if (!mounted) return;
      setState(() {
        _data = d;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = "सूची नहीं मिली — दोबारा कोशिश करें";
        _loading = false;
      });
    }
  }

  /// One GPS fix, or nothing. The server refuses a mark without a pin, so a
  /// failure here has to be shown rather than silently sending without it.
  Future<Position?> _fix() async {
    try {
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied ||
          perm == LocationPermission.deniedForever) {
        return null;
      }
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 20),
        ),
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> _mark(String studentId, String name, String kind) async {
    setState(() => _busy.add(studentId));
    try {
      Position? pos;
      if (kind != "absent") {
        pos = await _fix();
        if (pos == null) {
          if (!mounted) return;
          _toast("$name — लोकेशन नहीं मिली, दोबारा कोशिश करें", isError: true);
          return;
        }
      }
      await widget.api.markBoarding(
        routeId: widget.routeId,
        studentId: studentId,
        trip: _trip,
        kind: kind,
        lat: pos?.latitude,
        lng: pos?.longitude,
        accuracyM: pos?.accuracy,
      );
      if (!mounted) return;
      _toast(
        kind == "boarded"
            ? "$name — बस में चढ़ गए"
            : kind == "offboarded"
                ? "$name — बस से उतर गए"
                : "$name — अनुपस्थित",
      );
      await _load();
    } catch (e) {
      if (!mounted) return;
      _toast("$name — दर्ज नहीं हुआ", isError: true);
    } finally {
      if (mounted) setState(() => _busy.remove(studentId));
    }
  }

  void _toast(String msg, {bool isError = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg, style: const TextStyle(fontSize: 16)),
        backgroundColor: isError ? Colors.red.shade700 : Colors.green.shade700,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final stops = (_data?["stops"] as List?) ?? const [];
    final total = _data?["totalStudents"] ?? 0;
    final marked = _data?["markedStudents"] ?? 0;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.routeLabel,
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            onPressed: _load,
            icon: const Icon(Icons.refresh),
            tooltip: "ताज़ा करें",
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(56),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            child: Row(
              children: [
                Expanded(
                  child: SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(value: "AM", label: Text("सुबह — लेना")),
                      ButtonSegment(value: "PM", label: Text("दोपहर — छोड़ना")),
                    ],
                    selected: {_trip},
                    onSelectionChanged: (v) {
                      setState(() => _trip = v.first);
                      _load();
                    },
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  "$marked / $total",
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_error!, style: const TextStyle(fontSize: 18)),
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: _load,
                        child: const Text("दोबारा कोशिश करें"),
                      ),
                    ],
                  ),
                )
              : stops.isEmpty
                  ? const Center(
                      child: Text(
                        "इस रूट पर कोई स्टॉप नहीं है",
                        style: TextStyle(fontSize: 18),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        itemCount: stops.length,
                        itemBuilder: (context, i) =>
                            _stopCard(stops[i] as Map<String, dynamic>, i + 1),
                      ),
                    ),
    );
  }

  Widget _stopCard(Map<String, dynamic> stop, int n) {
    final students = (stop["students"] as List?) ?? const [];
    final km = stop["distanceKm"];
    return Card(
      margin: const EdgeInsets.fromLTRB(10, 8, 10, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            child: Row(
              children: [
                CircleAvatar(radius: 16, child: Text("$n")),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "${stop["name"]}",
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        "${students.length} बच्चे"
                        "${km != null && km != 0 ? " · स्कूल से $km कि.मी." : ""}",
                        style: const TextStyle(fontSize: 13),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (students.isEmpty)
            const Padding(
              padding: EdgeInsets.all(14),
              child: Text("इस स्टॉप पर कोई बच्चा नहीं",
                  style: TextStyle(fontSize: 15)),
            )
          else
            ...students.map((s) => _studentRow(s as Map<String, dynamic>)),
        ],
      ),
    );
  }

  Widget _studentRow(Map<String, dynamic> s) {
    final id = "${s["studentId"]}";
    final name = "${s["fullName"]}";
    final status = s["status"];
    final busy = _busy.contains(id);
    final done = status != null;
    final mode = "${s["serviceMode"]}";

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                // The name is the largest thing on the screen, and stays in
                // the script the school recorded it in.
                child: Text(
                  name,
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: done ? Colors.grey.shade600 : null,
                    decoration: status == "absent"
                        ? TextDecoration.lineThrough
                        : null,
                  ),
                ),
              ),
              if (mode == "pickup")
                const _Tag(text: "सिर्फ़ लेना")
              else if (mode == "drop")
                const _Tag(text: "सिर्फ़ छोड़ना"),
            ],
          ),
          Text(
            "${s["admissionNo"]}",
            style: TextStyle(fontSize: 12, color: Colors.grey.shade700),
          ),
          const SizedBox(height: 8),
          if (busy)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  SizedBox(width: 10),
                  Text("लोकेशन ली जा रही है…", style: TextStyle(fontSize: 15)),
                ],
              ),
            )
          else if (done)
            Row(
              children: [
                Icon(
                  status == "absent" ? Icons.cancel : Icons.check_circle,
                  color: status == "absent" ? Colors.red : Colors.green,
                ),
                const SizedBox(width: 6),
                Text(
                  status == "absent" ? "अनुपस्थित" : "दर्ज हो गया",
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const Spacer(),
                TextButton(
                  onPressed: () => _mark(id, name, _trip == "AM" ? "boarded" : "offboarded"),
                  child: const Text("बदलें", style: TextStyle(fontSize: 15)),
                ),
              ],
            )
          else
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => _mark(
                      id,
                      name,
                      _trip == "AM" ? "boarded" : "offboarded",
                    ),
                    icon: const Icon(Icons.how_to_reg),
                    label: Text(
                      _trip == "AM" ? "चढ़ गए" : "उतर गए",
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: () => _mark(id, name, "absent"),
                  child: const Text(
                    "नहीं आया",
                    style: TextStyle(fontSize: 16),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.secondaryContainer,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(text, style: const TextStyle(fontSize: 12)),
      );
}
