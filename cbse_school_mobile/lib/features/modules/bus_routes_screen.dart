import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "bus_route_live_screen.dart";
import "module_shell.dart";
import "../../core/i18n/locale_controller.dart";

/// Parent-facing bus routes list — same data drivers see (routes, stops,
/// vehicle), since no per-student route assignment exists yet to narrow it
/// down to "your child's bus" specifically.
///
/// With [live] (the staff app), each route opens [BusRouteLiveScreen]: the
/// bus on the map and arrival times at each stop. Parents keep the plain list
/// — their live view is their own child's bus (BusLiveMapScreen).
class BusRoutesScreen extends StatelessWidget {
  const BusRoutesScreen({super.key, required this.api, this.live = false});

  final ApiClient api;
  final bool live;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<TransportRouteInfo>>(
      guideId: "bus-routes",
      title: "All bus routes",
      load: api.fetchTransportRoutes,
      emptyIcon: Icons.directions_bus_outlined,
      emptyText: context.l10n.noBusRoutesPublishedYetContact,
      isEmpty: (routes) => routes.isEmpty,
      builder: (context, routes, _) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Padding(
            padding: EdgeInsets.only(bottom: 10),
            child: Text(
              live
                  ? context.l10n.busLiveTapHint
                  : context.l10n.allPublishedSchoolBusRoutesAsk,
              style: AppText.bodySmallMuted,
            ),
          ),
          for (final route in routes)
            Card(
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: !live || route.id.isEmpty
                    ? null
                    : () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => BusRouteLiveScreen(
                            api: api,
                            routeId: route.id,
                            title: route.name,
                          ),
                        ),
                      ),
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
                              style: AppText.labelMedium.copyWith(
                                color: ModuleTone.blue.foreground,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              route.name,
                              style: AppText.bodyLargeInk.copyWith(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          if (live)
                            Icon(
                              Icons.map_outlined,
                              size: 20,
                              color: ModuleTone.blue.foreground,
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
                        style: AppText.bodySmallMuted,
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
                                  style: AppText.bodyMediumInk,
                                ),
                              ),
                              Text(
                                "${route.stops[i].distanceKm} km",
                                style: AppText.labelMediumMuted,
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
