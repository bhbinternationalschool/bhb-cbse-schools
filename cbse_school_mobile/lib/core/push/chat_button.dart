import "dart:async";

import "package:flutter/material.dart";

import "../api/api_client.dart";

/// The chat button on every home's header (director, 29 Oct 2026): school
/// chat, with the caller's unread count from the server
/// (GET /api/v1/school-chat/unread). Every staff login gets it — what each
/// person may message is still decided by the server's school-chat rules.
///
/// The count is read on open, every [pollEvery] while the app is in the
/// foreground (never in the background), and again when the chat closes.
/// A failed read shows the button without a count; the chat screen itself
/// then says what went wrong.
class SchoolChatButton extends StatefulWidget {
  const SchoolChatButton({
    super.key,
    required this.api,
    required this.onOpen,
    this.studentId,
    this.color = Colors.white,
    this.pollEvery = const Duration(seconds: 60),
  });

  final ApiClient api;

  /// Push the school-chat list; the count is re-read when it returns.
  final Future<void> Function() onOpen;

  /// A family: the child it is acting for (the home's child picker).
  final String? studentId;
  final Color color;
  final Duration pollEvery;

  @override
  State<SchoolChatButton> createState() => _SchoolChatButtonState();
}

class _SchoolChatButtonState extends State<SchoolChatButton>
    with WidgetsBindingObserver {
  int _unread = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
    _start();
  }

  @override
  void didUpdateWidget(covariant SchoolChatButton old) {
    super.didUpdateWidget(old);
    if (old.studentId != widget.studentId) _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refresh();
      _start();
    } else {
      _timer?.cancel();
      _timer = null;
    }
  }

  void _start() {
    _timer?.cancel();
    _timer = Timer.periodic(widget.pollEvery, (_) => _refresh());
  }

  Future<void> _refresh() async {
    try {
      final n = await widget.api.fetchSchoolChatUnread(
        studentId: widget.studentId,
      );
      if (mounted) setState(() => _unread = n);
    } catch (_) {
      // Unknown — no count shown; the chat screen reports the failure.
    }
  }

  Future<void> _open() async {
    await widget.onOpen();
    if (mounted) await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final hindi = Localizations.localeOf(context).languageCode == "hi";
    return IconButton(
      key: const Key("chat-button"),
      tooltip: hindi ? "संदेश" : "Chat",
      onPressed: _open,
      icon: Badge(
        isLabelVisible: _unread > 0,
        label: Text(
          _unread > 99 ? "99+" : "$_unread",
          key: const Key("chat-button-count"),
        ),
        child: Icon(Icons.chat_bubble_outline, color: widget.color),
      ),
    );
  }
}
