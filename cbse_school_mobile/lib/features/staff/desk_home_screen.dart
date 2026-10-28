import "package:flutter/material.dart";

import "../../core/popups/app_popups.dart";
import "../../core/ui/running_strip.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/api/api_client.dart";
import "../../core/ui/stale_banner.dart";
import "../../core/theme/app_theme.dart";
import "../modules/chat_inbox_screen.dart";
import "../modules/school_chat_screen.dart";
import "../modules/notice_detail_screen.dart";
import "../modules/notices_screen.dart";
import "admission_leads_screen.dart";
import "class_gallery_screen.dart";
import "class_message_screen.dart";
import "ptm_teacher_screen.dart";
import "bus_register_screen.dart";
import "documents_screen.dart";
import "fee_counter_screen.dart";
import "fee_defaulters_screen.dart";
import "visitor_gate_screen.dart";
import "my_collections_screen.dart";
import "survey_day_screen.dart";
import "home_groups.dart";
import "staff_pay_overview_screens.dart";
import "leave_approvals_screen.dart";
import "my_attendance_calendar_screen.dart";
import "my_advances_screen.dart";
import "my_profile_screen.dart";
import "my_class_screen.dart";
import "month_register_screen.dart";
import "payslips_screen.dart";
import "self_attendance_screen.dart";
import "staff_complaints_screen.dart";
import "staff_leave_screen.dart";
import "staff_roster_screen.dart";
import "student_leave_queue_screen.dart";
import "transport_requests_screen.dart";
import "vehicle_logbook_screen.dart";
import "waiting_card.dart";
import "pending_work_card.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/push/notification_bell.dart";

String _greeting() {
  final h = DateTime.now().hour;
  if (h < 12) return "Good morning · सुप्रभात";
  if (h < 17) return "Good afternoon · नमस्ते";
  return "Good evening · नमस्ते";
}

class _Tile {
  const _Tile(
    this.label,
    this.hindi,
    this.icon,
    this.tone,
    this.feature,
    this.open,
  );

  final String label;
  final String hindi;
  final IconData icon;
  final ModuleTone tone;

  /// Mobile feature id from the ERP — the tile is hidden without it.
  final String feature;
  final Widget Function(ApiClient api) open;
}

/// Home for staff who neither teach nor drive: the office (accountant,
/// counsellor, computer operator, transport in-charge) and support staff
/// (peon, sweeper, gardener). Everyone gets punch, presence, notices,
/// leave and payslips; the office also gets the queues it works —
/// complaints, parents' leave, documents, transport requests.
///
/// Labels carry Hindi because most support staff read Hindi first.
class DeskHomeScreen extends StatefulWidget {
  const DeskHomeScreen({
    super.key,
    required this.api,
    required this.onLogout,
    this.openRoute,
  });

  final ApiClient api;
  final VoidCallback onLogout;
  final String? openRoute;

  @override
  State<DeskHomeScreen> createState() => _DeskHomeScreenState();
}

class _DeskHomeScreenState extends State<DeskHomeScreen> {
  String _name = "";
  String _photoUrl = "";
  String _kind = "support";
  int _refresh = 0;
  StaffFeatureSet _features = const StaffFeatureSet.empty();

  /// data-layer 4.4: set when the server could not be reached and the home
  /// shows the copy saved at this time; the banner says so.
  DateTime? _staleSince;
  final _clock = RefreshClock();
  late final _resume = ResumeWatcher(_onResume);
  bool _featuresFresh = false;

  static final _common = <_Tile>[
    _Tile(
      "GPS punch",
      "हाज़िरी",
      Icons.where_to_vote_outlined,
      ModuleTone.teal,
      "gps_punch",
      (api) => SelfAttendanceScreen(api: api),
    ),
    _Tile(
      "Notices",
      "सूचनाएँ",
      Icons.campaign_outlined,
      ModuleTone.pink,
      "notices",
      (api) => NoticesScreen(api: api),
    ),
    _Tile(
      "My leave",
      "छुट्टी",
      Icons.event_outlined,
      ModuleTone.coral,
      "my_leave",
      (api) => StaffLeaveScreen(api: api),
    ),
    _Tile(
      "Payslips",
      "वेतन पर्ची",
      Icons.receipt_long_outlined,
      ModuleTone.gray,
      "my_payslips",
      (api) => PayslipsScreen(api: api),
    ),
  ];

  static final _work = <_Tile>[
    // The office posts the school's photos (whole school or any class) and
    // decides on what the AI check held (15 Oct 2026).
    _Tile(
      "Gallery",
      "गैलरी",
      Icons.photo_library_outlined,
      ModuleTone.pink,
      "class_gallery",
      (api) => ClassGalleryScreen(api: api),
    ),
    _Tile(
      "Collect fees",
      "फ़ीस लें",
      Icons.point_of_sale_outlined,
      ModuleTone.green,
      "fee_take",
      (api) => FeeCounterScreen(api: api),
    ),
    _Tile(
      "Defaulters",
      "बकाया",
      Icons.currency_rupee,
      ModuleTone.coral,
      "fee_defaulters",
      (api) => FeeDefaultersScreen(api: api, canCollect: true),
    ),
    _Tile(
      "My collections",
      "आज का संग्रह",
      Icons.account_balance_wallet_outlined,
      ModuleTone.teal,
      "fee_collections",
      (api) => MyCollectionsScreen(api: api),
    ),
    _Tile(
      "Admission leads",
      "प्रवेश",
      Icons.how_to_reg_outlined,
      ModuleTone.blue,
      "admission_leads",
      (api) => AdmissionLeadsScreen(api: api),
    ),
    _Tile(
      "Field survey",
      "सर्वे",
      Icons.map_outlined,
      ModuleTone.amber,
      "field_survey",
      (api) => SurveyDayScreen(api: api),
    ),
    _Tile(
      "Visitor gate",
      "आगंतुक",
      Icons.meeting_room_outlined,
      ModuleTone.purple,
      "visitor_gate",
      (api) => VisitorGateScreen(api: api),
    ),
    _Tile(
      "Complaints",
      "शिकायतें",
      Icons.report_problem_outlined,
      ModuleTone.amber,
      "complaints_handle",
      (api) => StaffComplaintsScreen(api: api),
    ),
    _Tile(
      "Leave requests",
      "छात्र अवकाश",
      Icons.event_busy_outlined,
      ModuleTone.blue,
      "student_leave_decide",
      (api) => StudentLeaveQueueScreen(api: api),
    ),
    _Tile(
      "Documents",
      "दस्तावेज़",
      Icons.folder_open_outlined,
      ModuleTone.purple,
      "documents_verify",
      (api) => DocumentsScreen(api: api),
    ),
    _Tile(
      "Transport requests",
      "परिवहन",
      Icons.directions_bus_outlined,
      ModuleTone.blue,
      "transport_requests",
      (api) => TransportRequestsScreen(api: api),
    ),
    // Management, read only (20 Oct 2026): everyone's pay and advances.
    _Tile(
      "Staff payslips",
      "स्टाफ वेतन पर्ची",
      Icons.receipt_long_outlined,
      ModuleTone.gray,
      kStaffPayslipsAllFeature,
      (api) => StaffPayrollOverviewScreen(api: api),
    ),
    _Tile(
      "Staff advances",
      "स्टाफ एडवांस",
      Icons.account_balance_wallet_outlined,
      ModuleTone.amber,
      kStaffAdvancesAllFeature,
      (api) => StaffAdvancesOverviewScreen(api: api),
    ),
    // A desk person given the class grants (an office in-charge who keeps a
    // class): the class records and the month register. The server still
    // decides whose children each one shows.
    _Tile(
      "My class",
      "मेरी कक्षा",
      Icons.diversity_3_outlined,
      ModuleTone.purple,
      "students_view",
      (api) => MyClassScreen(api: api),
    ),
    _Tile(
      "Month register",
      "मासिक रजिस्टर",
      Icons.calendar_view_month_outlined,
      ModuleTone.teal,
      "attendance_mark",
      (api) => MonthRegisterScreen(api: api),
    ),
    // The transport in-charge works from this home: the bus register and
    // log book, every bus when the server grants the whole fleet.
    _Tile(
      "Bus register",
      "बस रजिस्टर",
      Icons.fact_check_outlined,
      ModuleTone.blue,
      "route_manifest",
      (api) => BusRegisterScreen(api: api),
    ),
    _Tile(
      "Log book",
      "लॉग बुक",
      Icons.local_gas_station_outlined,
      ModuleTone.amber,
      "route_manifest",
      (api) => VehicleLogbookScreen(api: api),
    ),
    _Tile(
      "Messages",
      "संदेश",
      Icons.chat_bubble_outline,
      ModuleTone.teal,
      "messages",
      (api) => staffSchoolChat(api),
    ),
    // An office-like member of staff may teach a section too; both tiles
    // show only when the ERP grants them.
    _Tile(
      "Message my classes",
      "कक्षा को संदेश",
      Icons.forum_outlined,
      ModuleTone.coral,
      "class_broadcast",
      (api) => ClassMessageScreen(api: api),
    ),
    _Tile(
      "PTM",
      "पीटीएम",
      Icons.groups_outlined,
      ModuleTone.purple,
      "ptm_meet",
      (api) => PtmTeacherScreen(api: api),
    ),
    _Tile(
      "Staff contacts",
      "कर्मचारी",
      Icons.contact_phone_outlined,
      ModuleTone.green,
      "staff_roster",
      (api) => StaffRosterScreen(api: api),
    ),
  ];

  /// Everyone's own record (the desk home has no bottom bar to carry it).
  static final _profileTile = _Tile(
    "My profile",
    "मेरी प्रोफ़ाइल",
    Icons.badge_outlined,
    ModuleTone.teal,
    "my_profile",
    (api) => MyProfileScreen(api: api),
  );

  /// My salary advances — the person's own record, always shown.
  static final _advancesTile = _Tile(
    "My advances",
    "मेरा एडवांस",
    Icons.account_balance_wallet_outlined,
    ModuleTone.amber,
    "my_advances",
    (api) => MyAdvancesScreen(api: api),
  );

  /// My month of attendance — the person's own record, always shown.
  static final _attendanceTile = _Tile(
    "My attendance",
    "मेरी हाज़िरी",
    Icons.calendar_month_outlined,
    ModuleTone.teal,
    "my_attendance",
    (api) => MyAttendanceCalendarScreen(api: api),
  );

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

  /// Back in front after 2 minutes or more: re-read the summary and tiles,
  /// so a Masters change shows without a restart.
  void _onResume() {
    if (mounted && _clock.isStale) _load();
  }

  /// Pull-to-refresh also re-reads the waiting counts.
  Future<void> _pullRefresh() async {
    setState(() => _refresh += 1);
    await _load();
  }

  void _showSummary(StaffSummary s, String? kind) {
    setState(() {
      _name = s.fullName;
      _photoUrl = s.photoUrl;
      _kind = s.homeKind.isEmpty ? (kind ?? "support") : s.homeKind;
    });
  }

  /// [first]: the app just opened this home — paint the saved copy at once.
  Future<void> _load({bool first = false}) async {
    final name = await widget.api.guardianName();
    final kind = await widget.api.homeKind();
    if (first) {
      widget.api.cachedStaffFeatures().then((c) {
        if (c != null && mounted && !_featuresFresh) {
          setState(() => _features = c.value);
        }
      });
    }
    var ok = false;
    var painted = false;
    await loadCachedThenFresh<StaffSummary>(
      peek: first ? widget.api.cachedStaffSummary : () async => null,
      fetch: widget.api.fetchStaffSummary,
      onCached: (c) {
        painted = true;
        if (mounted) _showSummary(c.value, kind);
      },
      onFresh: (s) {
        ok = true;
        _clock.markFresh();
        if (mounted) {
          _showSummary(s, kind);
          setState(() => _staleSince = null);
        }
      },
      onError: (_, since) {
        if (!mounted) return;
        setState(() {
          if (painted || _clock.lastFresh != null) {
            _staleSince = since ?? _clock.lastFresh ?? DateTime.now();
          } else {
            _name = name ?? "";
            _kind = kind ?? "support";
          }
        });
      },
    );
    if (ok) {
      try {
        final f = await widget.api.fetchStaffFeatures();
        _featuresFresh = true;
        if (mounted) setState(() => _features = f);
      } catch (_) {
        /* keep whatever we had */
      }
    }
    if (widget.openRoute != null && mounted) {
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _openDeepLink(widget.openRoute!),
      );
    }
  }

  Future<void> _push(Widget w) async {
    final changed = await Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => w));
    // The waiting counts are re-read only when that screen decided something.
    if (mounted && changed == true) setState(() => _refresh += 1);
  }

  void _openDeepLink(String raw) {
    final path = Uri.tryParse(raw)?.path ?? raw;
    switch (path) {
      case "/notifications":
        openNotifications(context, widget.api, _openDeepLink);
      case "/leave":
        _push(StaffLeaveScreen(api: widget.api));
      case "/leave-approvals":
        _push(LeaveApprovalsScreen(api: widget.api));
      case "/complaints":
        _push(StaffComplaintsScreen(api: widget.api));
      case "/student-leave":
        _push(StudentLeaveQueueScreen(api: widget.api));
      case "/documents":
        _push(DocumentsScreen(api: widget.api));
      case "/chat":
        _push(ChatInboxScreen(api: widget.api));
      case "/school-chat":
        _push(staffSchoolChat(widget.api));
      case "/notices":
        // A tapped broadcast opens in full; otherwise the notices list.
        _push(noticesScreenForRoute(widget.api, Uri.tryParse(raw)));
      case "/profile":
        _openProfile();
      case "/my-attendance":
        _push(
          MyAttendanceCalendarScreen(
            api: widget.api,
            initialMonth: Uri.tryParse(raw)?.queryParameters["month"],
          ),
        );
      case "/payslips":
        _push(PayslipsScreen(api: widget.api));
    }
  }

  void _openWaiting(String kind) {
    switch (kind) {
      case "staff_leave":
        _push(LeaveApprovalsScreen(api: widget.api));
      case "student_leave":
        _push(StudentLeaveQueueScreen(api: widget.api));
      case "complaints":
        _push(StaffComplaintsScreen(api: widget.api));
      case "documents":
        _push(DocumentsScreen(api: widget.api));
    }
  }

  Future<void> _signOut() async {
    await widget.api.signOut();
    if (mounted) widget.onLogout();
  }

  Future<void> _openProfile() async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => MyProfileScreen(api: widget.api, onSignOut: _signOut),
      ),
    );
    // A new photo shows in the header straight away.
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    // What appears is the ERP's answer, not a guess from the role name: an
    // accountant gets the fee counter, a sweeper gets punch and payslips.
    final office = _kind == "office" || _kind == "leadership";
    final tiles = [
      ..._common,
      ..._work,
    ].where((t) => _features.has(t.feature)).toList();
    // My profile is everyone's own record, not a grant — always shown.
    final groups = groupStaffTiles(
      [...tiles, _advancesTile, _attendanceTile, _profileTile],
      (t) => staffGroupOf(_features, t.feature),
      order: _features.groupOrder,
    );
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _pullRefresh,
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
                28,
              ),
              child: Row(
                children: [
                  StaffAvatar(
                    key: ValueKey(_photoUrl),
                    api: widget.api,
                    name: _name,
                    photoUrl: _photoUrl,
                    onTap: _openProfile,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _greeting(),
                          style: AppText.bodySmall.copyWith(
                            color: AppColors.accentSoft,
                          ),
                        ),
                        Text(
                          _name.isEmpty ? "Staff" : _name,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.titleMedium.copyWith(
                            color: Colors.white,
                          ),
                        ),
                        Text(
                          office ? "Office · कार्यालय" : "Staff · कर्मचारी",
                          style: AppText.bodySmall.copyWith(
                            color: Color(0xFFB8C0D4),
                          ),
                        ),
                      ],
                    ),
                  ),
                  NotificationBellButton(
                    api: widget.api,
                    onOpenRoute: _openDeepLink,
                  ),
                  const ScreenGuideButton(
                    guideId: "desk-home",
                    screenLabel: "Home",
                  ),
                  IconButton(
                    tooltip: context.l10n.signOut,
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
              onOpen: () => _push(NoticesScreen(api: widget.api)),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (office) ...[
                    WaitingCard(
                      api: widget.api,
                      onOpen: _openWaiting,
                      refreshKey: _refresh,
                    ),
                    const SizedBox(height: 8),
                  ],
                  PendingWorkCard(
                    api: widget.api,
                    onOpen: _openDeepLink,
                    refreshKey: _refresh,
                  ),
                  Card(
                    child: ListTile(
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
                        ),
                      ),
                      title: Text(
                        context.l10n.markMyAttendance,
                        style: AppText.bodyMediumInk.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      subtitle: Text(
                        context.l10n.gpsPunchInAndOutAt,
                        style: AppText.bodySmallMuted,
                      ),
                      trailing: const Icon(
                        Icons.chevron_right,
                        color: AppColors.muted,
                      ),
                      onTap: () => _push(SelfAttendanceScreen(api: widget.api)),
                    ),
                  ),
                  const SizedBox(height: 2),
                  // Tiles under their headings, in the ERP's order — both
                  // languages, as the tiles themselves carry.
                  for (final (group, list) in groups) ...[
                    StaffGroupHeading(group, bilingual: true),
                    GridView.count(
                      crossAxisCount: 3,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      mainAxisSpacing: 10,
                      crossAxisSpacing: 8,
                      childAspectRatio: 0.95,
                      children: [
                        for (final t in list)
                          InkWell(
                            borderRadius: BorderRadius.circular(16),
                            onTap: identical(t, _profileTile)
                                ? _openProfile
                                : () => _push(t.open(widget.api)),
                            child: Column(
                              children: [
                                Container(
                                  width: 52,
                                  height: 52,
                                  decoration: BoxDecoration(
                                    color: t.tone.background,
                                    borderRadius: BorderRadius.circular(16),
                                  ),
                                  child: Icon(
                                    t.icon,
                                    color: t.tone.foreground,
                                    size: 26,
                                  ),
                                ),
                                const SizedBox(height: 5),
                                Text(
                                  t.label,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: AppText.labelMediumInk,
                                ),
                                Text(
                                  t.hindi,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: AppText.labelSmallMuted,
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
