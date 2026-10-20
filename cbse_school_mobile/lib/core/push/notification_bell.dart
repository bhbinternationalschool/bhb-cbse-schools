import "package:flutter/material.dart";

import "../api/api_client.dart";
import "notifications_screen.dart";

/// The bell on every home's header: unread count from the server
/// (GET /api/v1/notifications), and the list on tap. Re-reads the count
/// when the list closes. A failed read shows the bell without a count —
/// the list itself then says "Could not load".
class NotificationBellButton extends StatefulWidget {
  const NotificationBellButton({
    super.key,
    required this.api,
    required this.onOpenRoute,
    this.color = Colors.white,
  });

  final ApiClient api;

  /// The home's own deep-link handler, for an item's link.
  final void Function(String route) onOpenRoute;
  final Color color;

  @override
  State<NotificationBellButton> createState() => _NotificationBellButtonState();
}

class _NotificationBellButtonState extends State<NotificationBellButton> {
  int _unread = 0;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    try {
      final inbox = await widget.api.fetchNotifications();
      if (mounted) setState(() => _unread = inbox.unread);
    } catch (_) {
      // Unknown — no count shown; the list reports the failure.
    }
  }

  Future<void> _open() async {
    await openNotifications(context, widget.api, widget.onOpenRoute);
    if (mounted) await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final hindi = Localizations.localeOf(context).languageCode == "hi";
    return IconButton(
      key: const Key("notify-bell"),
      tooltip: hindi ? "सूचनाएँ" : "Notifications",
      onPressed: _open,
      icon: Badge(
        isLabelVisible: _unread > 0,
        label: Text(
          _unread > 9 ? "9+" : "$_unread",
          key: const Key("notify-bell-count"),
        ),
        child: Icon(Icons.notifications_outlined, color: widget.color),
      ),
    );
  }
}

/// Push the notifications list; an item's link goes to [onOpenRoute].
Future<void> openNotifications(
  BuildContext context,
  ApiClient api,
  void Function(String route) onOpenRoute,
) => Navigator.of(context).push(
  MaterialPageRoute(
    builder: (_) => NotificationsScreen(api: api, onOpenRoute: onOpenRoute),
  ),
);
