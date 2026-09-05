import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../modules/chat_inbox_screen.dart";
import "../modules/notices_screen.dart";
import "documents_screen.dart";
import "leave_approvals_screen.dart";
import "payslips_screen.dart";
import "presence_screen.dart";
import "self_attendance_screen.dart";
import "staff_complaints_screen.dart";
import "staff_leave_screen.dart";
import "staff_roster_screen.dart";
import "student_leave_queue_screen.dart";
import "transport_requests_screen.dart";
import "waiting_card.dart";

String _greeting() {
  final h = DateTime.now().hour;
  if (h < 12) return "Good morning · सुप्रभात";
  if (h < 17) return "Good afternoon · नमस्ते";
  return "Good evening · नमस्ते";
}

class _Tile {
  const _Tile(this.label, this.hindi, this.icon, this.tone, this.open);

  final String label;
  final String hindi;
  final IconData icon;
  final ModuleTone tone;
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
  String _kind = "support";
  int _refresh = 0;

  static final _common = <_Tile>[
    _Tile(
      "GPS punch",
      "हाज़िरी",
      Icons.where_to_vote_outlined,
      ModuleTone.teal,
      (api) => SelfAttendanceScreen(api: api),
    ),
    _Tile(
      "Presence",
      "उपस्थिति",
      Icons.my_location,
      ModuleTone.green,
      (api) => PresenceScreen(api: api),
    ),
    _Tile(
      "Notices",
      "सूचनाएँ",
      Icons.campaign_outlined,
      ModuleTone.pink,
      (api) => NoticesScreen(api: api),
    ),
    _Tile(
      "My leave",
      "छुट्टी",
      Icons.event_outlined,
      ModuleTone.coral,
      (api) => StaffLeaveScreen(api: api),
    ),
    _Tile(
      "Payslips",
      "वेतन पर्ची",
      Icons.receipt_long_outlined,
      ModuleTone.gray,
      (api) => PayslipsScreen(api: api),
    ),
  ];

  static final _office = <_Tile>[
    _Tile(
      "Complaints",
      "शिकायतें",
      Icons.report_problem_outlined,
      ModuleTone.amber,
      (api) => StaffComplaintsScreen(api: api),
    ),
    _Tile(
      "Leave requests",
      "छात्र अवकाश",
      Icons.event_busy_outlined,
      ModuleTone.blue,
      (api) => StudentLeaveQueueScreen(api: api),
    ),
    _Tile(
      "Documents",
      "दस्तावेज़",
      Icons.folder_open_outlined,
      ModuleTone.purple,
      (api) => DocumentsScreen(api: api),
    ),
    _Tile(
      "Transport requests",
      "परिवहन",
      Icons.directions_bus_outlined,
      ModuleTone.blue,
      (api) => TransportRequestsScreen(api: api),
    ),
    _Tile(
      "Messages",
      "संदेश",
      Icons.chat_bubble_outline,
      ModuleTone.teal,
      (api) => ChatInboxScreen(api: api),
    ),
    _Tile(
      "Staff contacts",
      "कर्मचारी",
      Icons.contact_phone_outlined,
      ModuleTone.green,
      (api) => StaffRosterScreen(api: api),
    ),
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final name = await widget.api.guardianName();
    final kind = await widget.api.homeKind();
    try {
      final s = await widget.api.fetchStaffSummary();
      if (mounted) {
        setState(() {
          _name = s.fullName;
          _kind = s.homeKind.isEmpty ? (kind ?? "support") : s.homeKind;
          _refresh += 1;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _name = name ?? "";
          _kind = kind ?? "support";
        });
      }
    }
    if (widget.openRoute != null && mounted) {
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _openDeepLink(widget.openRoute!),
      );
    }
  }

  void _push(Widget w) =>
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => w));

  void _openDeepLink(String raw) {
    final path = Uri.tryParse(raw)?.path ?? raw;
    switch (path) {
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
      case "/notices":
        _push(NoticesScreen(api: widget.api));
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

  @override
  Widget build(BuildContext context) {
    final office = _kind == "office";
    final tiles = [..._common, if (office) ..._office];
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
                28,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _greeting(),
                          style: const TextStyle(
                            color: AppColors.accentSoft,
                            fontSize: 12,
                          ),
                        ),
                        Text(
                          _name.isEmpty ? "Staff" : _name,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 17,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          office ? "Office · कार्यालय" : "Staff · कर्मचारी",
                          style: const TextStyle(
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
                  if (office) ...[
                    WaitingCard(
                      api: widget.api,
                      onOpen: _openWaiting,
                      refreshKey: _refresh,
                    ),
                    const SizedBox(height: 8),
                  ],
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
                      title: const Text(
                        "Mark my attendance · हाज़िरी लगाएँ",
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                      subtitle: const Text(
                        "GPS punch in and out at school",
                        style: TextStyle(fontSize: 12, color: AppColors.muted),
                      ),
                      trailing: const Icon(
                        Icons.chevron_right,
                        color: AppColors.muted,
                      ),
                      onTap: () => _push(SelfAttendanceScreen(api: widget.api)),
                    ),
                  ),
                  const SizedBox(height: 14),
                  GridView.count(
                    crossAxisCount: 3,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 10,
                    crossAxisSpacing: 8,
                    childAspectRatio: 0.95,
                    children: [
                      for (final t in tiles)
                        InkWell(
                          borderRadius: BorderRadius.circular(16),
                          onTap: () => _push(t.open(widget.api)),
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
                                style: const TextStyle(
                                  fontSize: 11.5,
                                  color: AppColors.ink,
                                ),
                              ),
                              Text(
                                t.hindi,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 10.5,
                                  color: AppColors.muted,
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
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
