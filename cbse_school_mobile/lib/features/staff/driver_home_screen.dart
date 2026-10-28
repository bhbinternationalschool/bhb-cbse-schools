import "package:flutter/material.dart";
import "../../core/popups/app_popups.dart";
import "../modules/notices_screen.dart";
import "../../core/ui/running_strip.dart";
import "../../core/guide/screen_guides.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/ui/stale_banner.dart";
import "../../core/theme/app_theme.dart";
import "bus_register_screen.dart";
import "vehicle_logbook_screen.dart";
import "../modules/notice_detail_screen.dart";
import "my_advances_screen.dart";
import "my_attendance_calendar_screen.dart";
import "payslips_screen.dart";
import "self_attendance_screen.dart";
import "transport_requests_screen.dart";
import "pending_work_card.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/push/notification_bell.dart";

/// Driver home (field persona): the bus register and log book for the
/// driver's own bus, GPS self-attendance, and the school's routes with
/// ordered stops and vehicle details.
///
/// In Hindi, because the drivers and attendants who use it read Hindi. The
/// rest of the app stays in English — this is the one screen whose audience
/// is different.
class DriverHomeScreen extends StatefulWidget {
  const DriverHomeScreen({
    super.key,
    required this.api,
    required this.onLogout,
    this.openRoute,
  });

  final ApiClient api;
  final VoidCallback onLogout;

  /// Deep link from a notification tap ("/notices?notice=…",
  /// "/my-attendance"), opened once the routes have loaded.
  final String? openRoute;

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

  /// The server's mobile grants; null until read (or when the read failed).
  StaffFeatureSet? _features;
  String? _error;
  bool _deepLinkDone = false;

  /// data-layer 4.4: set when the server could not be reached and the home
  /// shows the copy saved at this time; the banner says so.
  DateTime? _staleSince;
  final _clock = RefreshClock();
  late final _resume = ResumeWatcher(_onResume);
  bool _featuresFresh = false;

  @override
  void initState() {
    super.initState();
    // The school's pop-up for staff, if any — once per app open (core/popups).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) AppPopups.maybeShow(context, widget.api);
    });
    _resume.attach();
    _load(first: true);
  }

  @override
  void dispose() {
    _resume.detach();
    super.dispose();
  }

  /// Back in front after 2 minutes or more: re-read routes and tiles.
  void _onResume() {
    if (mounted && _clock.isStale) _load();
  }

  /// [first]: the app just opened this home — paint the saved copy at once.
  Future<void> _load({bool first = false}) async {
    setState(() => _error = null);
    final name = await widget.api.guardianName();
    if (mounted && _name == null) setState(() => _name = name);
    if (first) {
      widget.api.cachedStaffFeatures().then((c) {
        if (c != null && mounted && !_featuresFresh) {
          setState(() => _features = c.value);
        }
      });
    }
    var ok = false;
    await loadCachedThenFresh<List<TransportRouteInfo>>(
      peek: first ? widget.api.cachedTransportRoutes : () async => null,
      fetch: widget.api.fetchTransportRoutes,
      onCached: (c) {
        if (mounted) setState(() => _routes = c.value);
      },
      onFresh: (routes) {
        ok = true;
        _clock.markFresh();
        if (mounted) {
          setState(() {
            _routes = routes;
            _staleSince = null;
          });
        }
      },
      onError: (e, since) {
        if (!mounted) return;
        setState(() {
          if (_routes != null) {
            _staleSince = since ?? _clock.lastFresh ?? DateTime.now();
          } else {
            _error = e is ApiException
                ? e.message
                : "स्कूल सर्वर से संपर्क नहीं हुआ।";
          }
        });
      },
    );
    if (!mounted || _routes == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) => _consumeDeepLink());
    if (!ok) return;
    // Grants for the tiles (bus register, log book, payslips). Unknown:
    // the tiles stay and the server answers for itself.
    try {
      final f = await widget.api.fetchStaffFeatures();
      _featuresFresh = true;
      if (mounted) setState(() => _features = f);
    } catch (_) {
      /* unknown: the tiles stay and the server answers for itself */
    }
  }

  Widget _payCard({
    required IconData icon,
    required ModuleTone tone,
    required String title,
    required Widget Function() open,
  }) => Card(
    child: ListTile(
      onTap: () =>
          Navigator.of(context).push(MaterialPageRoute(builder: (_) => open())),
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: tone.background,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Icon(icon, color: tone.foreground, size: 22),
      ),
      title: Text(
        title,
        style: AppText.bodyMediumInk.copyWith(fontWeight: FontWeight.w600),
      ),
      trailing: const Icon(Icons.chevron_right, color: AppColors.muted),
    ),
  );

  void _consumeDeepLink() {
    final raw = widget.openRoute;
    if (raw == null || _deepLinkDone || !mounted) return;
    _deepLinkDone = true;
    _openRoute(raw);
  }

  /// A deep link: a tapped push, or an item of the notifications list.
  void _openRoute(String raw) {
    if (!mounted) return;
    final uri = Uri.tryParse(raw);
    if ((uri?.path ?? raw) == "/notifications") {
      openNotifications(context, widget.api, _openRoute);
      return;
    }
    final Widget? screen = switch (uri?.path ?? raw) {
      "/notices" => noticesScreenForRoute(widget.api, uri),
      "/my-attendance" => MyAttendanceCalendarScreen(
        api: widget.api,
        initialMonth: uri?.queryParameters["month"],
      ),
      _ => null,
    };
    if (screen != null) {
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
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
          SnackBar(
            content: Text(context.l10n.noStopOnMap, style: AppText.titleSmall),
          ),
        );
      }
      return;
    }

    final origin = "${pinned.first.lat},${pinned.first.lng}";
    final waypoints = pinned.skip(1).map((s) => "${s.lat},${s.lng}").join("|");
    final uri = Uri.parse(
      "https://www.google.com/maps/dir/?api=1"
      "&origin=$origin"
      "&destination=$_schoolLat,$_schoolLng"
      "&travelmode=driving"
      "${waypoints.isEmpty ? "" : "&waypoints=${Uri.encodeComponent(waypoints)}"}",
    );
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  /// The bus register and log book sit behind `route_manifest` (Masters →
  /// Roles → Mobile app). They are hidden only when the server has said this
  /// person does not hold it; an unread grant list hides nothing, and the
  /// server still decides which bus each screen shows.
  bool get _crewTools => _features == null || _features!.has("route_manifest");

  Widget _toolTile({
    required IconData icon,
    required ModuleTone tone,
    required String title,
    required String subtitle,
    required Widget Function() open,
  }) => Card(
    child: ListTile(
      onTap: () =>
          Navigator.of(context).push(MaterialPageRoute(builder: (_) => open())),
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: tone.background,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Icon(icon, color: tone.foreground, size: 22),
      ),
      title: Text(
        title,
        style: AppText.bodyMediumInk.copyWith(fontWeight: FontWeight.w600),
      ),
      subtitle: Text(subtitle, style: AppText.labelMediumMuted),
      trailing: const Icon(Icons.chevron_right, color: AppColors.muted),
    ),
  );

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
                        child: Text(context.l10n.tryAgain),
                      ),
                      TextButton(
                        onPressed: _signOut,
                        child: Text(context.l10n.signOutCrew),
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
                borderRadius: BorderRadius.vertical(
                  bottom: Radius.circular(28),
                ),
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
                          style: AppText.titleMedium.copyWith(
                            color: Colors.white,
                          ),
                        ),
                        Text(
                          context.l10n.transport,
                          style: AppText.bodySmall.copyWith(
                            color: Color(0xFFB8C0D4),
                          ),
                        ),
                      ],
                    ),
                  ),
                  NotificationBellButton(
                    api: widget.api,
                    onOpenRoute: _openRoute,
                  ),
                  const ScreenGuideButton(
                    guideId: "driver-home",
                    screenLabel: "Home",
                  ),
                  IconButton(
                    tooltip: context.l10n.signOutCrew,
                    onPressed: _signOut,
                    icon: const Icon(Icons.logout, color: Colors.white),
                  ),
                ],
              ),
            ),
            StaleBanner(since: _staleSince, onRetry: _load),
            // Notices and news scrolling across, as on the web ERP.
            RunningStrip(
              api: widget.api,
              onOpen: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => NoticesScreen(api: widget.api),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  PendingWorkCard(api: widget.api, onOpen: _openRoute),
                  if (_crewTools) ...[
                    _toolTile(
                      icon: Icons.fact_check_outlined,
                      tone: ModuleTone.blue,
                      title: "Bus register · बस रजिस्टर",
                      subtitle: "Mark children on and off the bus · हाज़िरी",
                      open: () => BusRegisterScreen(api: widget.api),
                    ),
                    _toolTile(
                      icon: Icons.local_gas_station_outlined,
                      tone: ModuleTone.amber,
                      title: "Log book · लॉग बुक",
                      subtitle: "Odometer and fuel · मीटर और ईंधन",
                      open: () => VehicleLogbookScreen(api: widget.api),
                    ),
                  ],
                  // The transport in-charge signs in through this home too
                  // (their role reads as transport crew). The office queue is
                  // theirs; a driver tapping it is told by the server it is not.
                  Card(
                    child: ListTile(
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) =>
                              TransportRequestsScreen(api: widget.api),
                        ),
                      ),
                      leading: const Icon(
                        Icons.directions_bus_outlined,
                        color: AppColors.primary,
                      ),
                      title: Text(
                        context.l10n.transportRequestsFromParents,
                        style: AppText.bodyMedium.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      trailing: const Icon(
                        Icons.chevron_right,
                        color: AppColors.muted,
                      ),
                    ),
                  ),
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
                      title: Text(
                        context.l10n.myAttendanceHome,
                        style: AppText.bodyMediumInk.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      subtitle: Text(
                        context.l10n.gpsPunchCampus,
                        style: AppText.labelMediumMuted,
                      ),
                      // The punch stays the tap; the month is beside it.
                      trailing: IconButton(
                        tooltip: "मेरा महीना · My month",
                        onPressed: () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) =>
                                MyAttendanceCalendarScreen(api: widget.api),
                          ),
                        ),
                        icon: Icon(
                          Icons.calendar_month_outlined,
                          color: ModuleTone.teal.foreground,
                        ),
                      ),
                    ),
                  ),
                  // My pay: payslips (with the grant) and my advances
                  // (everyone's own record, always shown).
                  if (_features?.has("my_payslips") == true)
                    _payCard(
                      icon: Icons.receipt_long_outlined,
                      tone: ModuleTone.gray,
                      title: "वेतन पर्ची · Payslips",
                      open: () => PayslipsScreen(api: widget.api),
                    ),
                  _payCard(
                    icon: Icons.account_balance_wallet_outlined,
                    tone: ModuleTone.amber,
                    title: "मेरा एडवांस · My advances",
                    open: () => MyAdvancesScreen(api: widget.api),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    context.l10n.route,
                    style: AppText.bodyLargeInk.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (routes.isEmpty)
                    Card(
                      child: Padding(
                        padding: EdgeInsets.all(14),
                        child: Text(
                          context.l10n.noRoutesYet,
                          style: AppText.bodySmallMuted,
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
                                style: AppText.bodySmallMuted,
                              ),
                              const SizedBox(height: 12),
                              // Marking children is the bus register's
                              // (above): it shows only this driver's own bus.
                              OutlinedButton.icon(
                                onPressed: () => _openRouteMap(route),
                                icon: const Icon(Icons.map_outlined, size: 18),
                                label: Text(
                                  context.l10n.routeWay,
                                  style: AppText.bodyLarge,
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
                                        child: Padding(
                                          padding: const EdgeInsets.only(
                                            top: 0,
                                          ),
                                          child: Text(
                                            route.stops[i].name,
                                            style: AppText.bodyMediumInk,
                                          ),
                                        ),
                                      ),
                                      Text(
                                        route.stops[i].hasPin
                                            ? "${route.stops[i].distanceKm} कि.मी."
                                            : "मैप पर नहीं",
                                        style: AppText.labelMedium.copyWith(
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
