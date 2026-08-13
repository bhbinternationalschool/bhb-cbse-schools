import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../modules/module_shell.dart";
import "self_attendance_screen.dart";

/// Driver home (field persona): the school's routes with ordered stops and
/// vehicle details, plus GPS self-attendance. Student boarding lists and
/// live tracking stay honest coming-soon states until the office assigns
/// students to stops.
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
        setState(() => _error = "Could not reach the school server.");
      }
    }
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
                      FilledButton(onPressed: _load, child: const Text("Retry")),
                      TextButton(
                        onPressed: _signOut,
                        child: const Text("Sign out"),
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
                          _name ?? "Driver",
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 17,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const Text(
                          "Transport",
                          style: TextStyle(
                            color: Color(0xFFB8C0D4),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: "Sign out",
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
                        "My attendance",
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                      subtitle: const Text(
                        "GPS punch in / out from campus",
                        style:
                            TextStyle(fontSize: 11.5, color: AppColors.muted),
                      ),
                      trailing: const Icon(Icons.chevron_right,
                          color: AppColors.muted),
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Text(
                    "Routes",
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
                          "No routes published yet. Routes appear here once the transport desk sets them up.",
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
                                    "${route.seatCapacity} seats",
                                  if ((route.driverName ?? "").isNotEmpty)
                                    "Driver: ${route.driverName}",
                                ].join(" · "),
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: AppColors.muted,
                                ),
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
                                        "${route.stops[i].distanceKm} km",
                                        style: const TextStyle(
                                          fontSize: 11.5,
                                          color: AppColors.muted,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                  const SizedBox(height: 8),
                  Card(
                    child: ListTile(
                      dense: true,
                      leading: const Icon(Icons.qr_code_scanner,
                          color: AppColors.muted),
                      title: const Text(
                        "Student boarding & live GPS",
                        style: TextStyle(fontSize: 13, color: AppColors.ink),
                      ),
                      subtitle: const Text(
                        "Opens once the office assigns students to stops.",
                        style:
                            TextStyle(fontSize: 11.5, color: AppColors.muted),
                      ),
                      onTap: () => showComingSoon(
                        context,
                        "Boarding & tracking",
                        "Student stop assignments haven't been set up in the transport desk yet. Scanning student IDs at boarding and live bus tracking go live once they are.",
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
