import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "route_manifest_screen.dart";
import "self_attendance_screen.dart";

/// Driver home (field persona): the school's routes with ordered stops and
/// vehicle details, GPS self-attendance, and the day's boarding list.
///
/// In Hindi, because the drivers and attendants who use it read Hindi. The
/// rest of the app stays in English — this is the one screen whose audience
/// is different.
class DriverHomeScreen extends StatefulWidget {
  const DriverHomeScreen({
    super.key,
    required this.api,
    required this.onLogout,
  });

  final ApiClient api;
  final VoidCallback onLogout;

  @override
  State<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

/// The campus, as the transport desk records it. Every route ends here in the
/// morning and starts here in the afternoon.
const _schoolLat = 25.4354328;
const _schoolLng = 82.9439863;

class _DriverHomeScreenState extends State<DriverHomeScreen> {
  List<TransportRouteInfo>? _routes;
  String? _name;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final name = await widget.api.guardianName();
      final routes = await widget.api.fetchTransportRoutes();
      if (!mounted) return;
      setState(() {
        _routes = routes;
        _name = name;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = "स्कूल सर्वर से संपर्क नहीं हुआ।");
      }
    }
  }

  /// Opens the route in Google Maps: stops in order, campus as the
  /// destination. Only pinned stops go in — an unpinned stop is left out of
  /// the route rather than guessed at, and the count is shown to the driver
  /// so a half-mapped route is never mistaken for the whole one.
  Future<void> _openRouteMap(TransportRouteInfo route) async {
    final pinned = route.stops.where((s) => s.hasPin).toList();
    if (pinned.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              "इस रूट का कोई स्टॉप मैप पर नहीं लगा है — दफ़्तर से कहें",
              style: TextStyle(fontSize: 15),
            ),
          ),
        );
      }
      return;
    }

    final origin = "${pinned.first.lat},${pinned.first.lng}";
    final waypoints = pinned
        .skip(1)
        .map((s) => "${s.lat},${s.lng}")
        .join("|");
    final uri = Uri.parse(
      "https://www.google.com/maps/dir/?api=1"
      "&origin=$origin"
      "&destination=$_schoolLat,$_schoolLng"
      "&travelmode=driving"
      "${waypoints.isEmpty ? "" : "&waypoints=${Uri.encodeComponent(waypoints)}"}",
    );
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  Future<void> _signOut() async {
    await widget.api.signOut();
    if (mounted) widget.onLogout();
  }

  @override
  Widget build(BuildContext context) {
    final routes = _routes;
    if (routes == null) {
      return Scaffold(
        body: Center(
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
                        child: const Text("दोबारा कोशिश करें"),
                      ),
                      TextButton(
                        onPressed: _signOut,
                        child: const Text("साइन आउट"),
                      ),
                    ],
                  ),
                ),
        ),
      );
    }

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _load,
        color: AppColors.primary,
        child: ListView(
          padding: EdgeInsets.zero,
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            Container(
              decoration: const BoxDecoration(
                color: AppColors.primary,
                borderRadius:
                    BorderRadius.vertical(bottom: Radius.circular(28)),
              ),
              padding: EdgeInsets.fromLTRB(
                20,
                MediaQuery.paddingOf(context).top + 18,
                12,
                24,
              ),
              child: Row(
                children: [
                  Container(
                    width: 46,
                    height: 46,
                    decoration: BoxDecoration(
                      color: AppColors.accentSoft,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(
                      Icons.directions_bus_outlined,
                      color: AppColors.primary,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _name ?? "चालक",
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 17,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const Text(
                          "परिवहन",
                          style: TextStyle(
                            color: Color(0xFFB8C0D4),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: "साइन आउट",
                    onPressed: _signOut,
                    icon: const Icon(Icons.logout, color: Colors.white),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Card(
                    child: ListTile(
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => SelfAttendanceScreen(api: widget.api),
                        ),
                      ),
                      leading: Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: ModuleTone.teal.background,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Icon(
                          Icons.where_to_vote_outlined,
                          color: ModuleTone.teal.foreground,
                          size: 22,
                        ),
                      ),
                      title: const Text(
                        "मेरी हाज़िरी",
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                      subtitle: const Text(
                        "कैंपस से GPS पंच इन / आउट",
                        style:
                            TextStyle(fontSize: 11.5, color: AppColors.muted),
                      ),
                      trailing: const Icon(Icons.chevron_right,
                          color: AppColors.muted),
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Text(
                    "रूट",
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (routes.isEmpty)
                    const Card(
                      child: Padding(
                        padding: EdgeInsets.all(14),
                        child: Text(
                          "अभी कोई रूट नहीं है। दफ़्तर से रूट बनते ही यहाँ दिखेंगे।",
                          style: TextStyle(
                            fontSize: 12.5,
                            color: AppColors.muted,
                          ),
                        ),
                      ),
                    )
                  else
                    for (final route in routes)
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 8,
                                      vertical: 3,
                                    ),
                                    decoration: BoxDecoration(
                                      color: ModuleTone.blue.background,
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Text(
                                      route.code,
                                      style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w700,
                                        color: ModuleTone.blue.foreground,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      route.name,
                                      style: const TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w600,
                                        color: AppColors.ink,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(
                                [
                                  if (route.vehicleName.isNotEmpty)
                                    route.vehicleName,
                                  if (route.vehicleReg.isNotEmpty)
                                    route.vehicleReg,
                                  if (route.seatCapacity != null)
                                    "${route.seatCapacity} सीट",
                                  if ((route.driverName ?? "").isNotEmpty)
                                    "चालक: ${route.driverName}",
                                ].join(" · "),
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: AppColors.muted,
                                ),
                              ),
                              const SizedBox(height: 12),
                              Row(
                                children: [
                                  Expanded(
                                    child: FilledButton.icon(
                                      onPressed: () =>
                                          Navigator.of(context).push(
                                        MaterialPageRoute(
                                          builder: (_) => RouteManifestScreen(
                                            api: widget.api,
                                            routeId: route.id,
                                            routeLabel: route.name.isEmpty
                                                ? route.code
                                                : route.name,
                                          ),
                                        ),
                                      ),
                                      icon: const Icon(Icons.fact_check_outlined,
                                          size: 18),
                                      label: const Text(
                                        "हाज़िरी लें",
                                        style: TextStyle(
                                          fontSize: 14,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  OutlinedButton.icon(
                                    onPressed: () => _openRouteMap(route),
                                    icon: const Icon(Icons.map_outlined,
                                        size: 18),
                                    label: const Text(
                                      "रास्ता",
                                      style: TextStyle(fontSize: 14),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 12),
                              for (var i = 0; i < route.stops.length; i++)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 2),
                                  child: Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Column(
                                        children: [
                                          Container(
                                            width: 12,
                                            height: 12,
                                            decoration: BoxDecoration(
                                              color: i == 0
                                                  ? AppColors.success
                                                  : i ==
                                                          route.stops.length -
                                                              1
                                                      ? AppColors.danger
                                                      : AppColors.primaryMid,
                                              shape: BoxShape.circle,
                                            ),
                                          ),
                                          if (i < route.stops.length - 1)
                                            Container(
                                              width: 2,
                                              height: 26,
                                              color: const Color(0xFFD8D6CC),
                                            ),
                                        ],
                                      ),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: Padding(
                                          padding:
                                              const EdgeInsets.only(top: 0),
                                          child: Text(
                                            route.stops[i].name,
                                            style: const TextStyle(
                                              fontSize: 13,
                                              color: AppColors.ink,
                                            ),
                                          ),
                                        ),
                                      ),
                                      Text(
                                        route.stops[i].hasPin
                                            ? "${route.stops[i].distanceKm} कि.मी."
                                            : "मैप पर नहीं",
                                        style: TextStyle(
                                          fontSize: 11.5,
                                          color: route.stops[i].hasPin
                                              ? AppColors.muted
                                              : AppColors.danger,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                            ],
                          ),
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
