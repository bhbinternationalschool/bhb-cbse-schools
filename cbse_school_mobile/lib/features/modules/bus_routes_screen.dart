import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "module_shell.dart";

/// Parent-facing bus routes list — same data drivers see (routes, stops,
/// vehicle), since no per-student route assignment exists yet to narrow it
/// down to "your child's bus" specifically.
class BusRoutesScreen extends StatelessWidget {
  const BusRoutesScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<TransportRouteInfo>>(
      title: "All bus routes",
      load: api.fetchTransportRoutes,
      emptyIcon: Icons.directions_bus_outlined,
      emptyText:
          "No bus routes published yet. Contact the school office to find your child's route.",
      isEmpty: (routes) => routes.isEmpty,
      builder: (context, routes, _) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          const Padding(
            padding: EdgeInsets.only(bottom: 10),
            child: Text(
              "All published school bus routes. Ask the office which one your child is on.",
              style: TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          ),
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
                        if (route.vehicleName.isNotEmpty) route.vehicleName,
                        if (route.vehicleReg.isNotEmpty) route.vehicleReg,
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
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Column(
                              children: [
                                Container(
                                  width: 12,
                                  height: 12,
                                  decoration: BoxDecoration(
                                    color: i == 0
                                        ? AppColors.success
                                        : i == route.stops.length - 1
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
                              child: Text(
                                route.stops[i].name,
                                style: const TextStyle(
                                  fontSize: 13,
                                  color: AppColors.ink,
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
        ],
      ),
    );
  }
}
