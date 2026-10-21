import "dart:async";

import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "chat_inbox_screen.dart";
import "module_shell.dart";

/// School chat — one screen for both apps (it imports nothing under
/// features/staff, so the parent build can carry it).
///
/// Parent app: [studentId] is the child picked on the home screen; the
/// server checks that child is the family's and is in each group. In a
/// group the family writes AS the child ("Name (Class-Sec)"); in a direct
/// chat with a teacher it writes as the parent. Staff app: [studentId] is
/// null.
///
/// [classTeacherThread]: the older parent ↔ class-teacher thread
/// (/api/v1/chat/*) — the parent's thread, or the class teacher's inbox of
/// them — kept as the first row ([classTeacherThreadLabel]).
class SchoolChatScreen extends StatelessWidget {
  const SchoolChatScreen({
    super.key,
    required this.api,
    this.studentId,
    this.childName,
    this.classTeacherThread,
    this.classTeacherThreadLabel,
  });

  final ApiClient api;
  final String? studentId;
  final String? childName;
  final WidgetBuilder? classTeacherThread;
  final String? classTeacherThreadLabel;

  bool get _family => studentId != null;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return ModuleShell<SchoolChatList>(
      title: l.schoolChatTitle,
      subtitle: childName,
      load: () => api.fetchSchoolChats(studentId: studentId),
      emptyIcon: Icons.forum_outlined,
      emptyText: l.schoolChatNone,
      isEmpty: (d) =>
          !d.blocked && d.conversations.isEmpty && classTeacherThread == null,
      builder: (context, data, reload) {
        if (data.blocked) {
          return ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(24),
            children: [
              const Icon(Icons.block, size: 40, color: AppColors.danger),
              const SizedBox(height: 12),
              Text(
                l.schoolChatPaused,
                key: const Key("school-chat-paused"),
                textAlign: TextAlign.center,
              ),
            ],
          );
        }
        final groups = data.conversations.where((c) => c.isGroup).toList();
        final direct = data.conversations.where((c) => !c.isGroup).toList();
        Future<void> open(SchoolChatConversation c) async {
          await Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => SchoolChatThreadScreen(
                api: api,
                conversationId: c.id,
                title: c.title,
                studentId: studentId,
                childName: childName,
                isGroup: c.isGroup,
              ),
            ),
          );
          await reload();
        }

        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(14),
          children: [
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                children: [
                  const Icon(
                    Icons.verified_user_outlined,
                    size: 16,
                    color: AppColors.muted,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      l.schoolChatSafety,
                      style: AppText.bodySmallMuted,
                    ),
                  ),
                ],
              ),
            ),
            if (classTeacherThread != null)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.person_outline),
                  title: Text(
                    classTeacherThreadLabel ?? l.schoolChatClassTeacherThread,
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(
                    context,
                  ).push(MaterialPageRoute(builder: classTeacherThread!)),
                ),
              ),
            if (groups.isNotEmpty) _Heading(l.schoolChatGroups),
            for (final c in groups)
              _ConversationTile(c: c, onTap: () => open(c)),
            if (direct.isNotEmpty) _Heading(l.schoolChatDirect),
            for (final c in direct)
              _ConversationTile(c: c, onTap: () => open(c)),
            if (_family) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                key: const Key("school-chat-new"),
                icon: const Icon(Icons.edit_outlined),
                label: Text(l.schoolChatNewMessage),
                onPressed: () async {
                  final contacts = await api.fetchSchoolChatContacts(
                    studentId: studentId,
                  );
                  if (!context.mounted) return;
                  final pick = await showModalBottomSheet<SchoolChatContact>(
                    context: context,
                    builder: (_) => SafeArea(
                      child: ListView(
                        shrinkWrap: true,
                        children: [
                          for (final c in contacts)
                            ListTile(
                              title: Text(c.name),
                              subtitle: c.role.isEmpty ? null : Text(c.role),
                              onTap: () => Navigator.of(context).pop(c),
                            ),
                        ],
                      ),
                    ),
                  );
                  if (pick == null || !context.mounted) return;
                  try {
                    final id = await api.openSchoolChatWithStaff(
                      pick.id,
                      studentId: studentId,
                    );
                    if (!context.mounted) return;
                    await Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => SchoolChatThreadScreen(
                          api: api,
                          conversationId: id,
                          title: pick.name,
                          studentId: studentId,
                          childName: childName,
                          isGroup: false,
                        ),
                      ),
                    );
                    await reload();
                  } on ApiException catch (e) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(
                        context,
                      ).showSnackBar(SnackBar(content: Text(e.message)));
                    }
                  }
                },
              ),
            ],
          ],
        );
      },
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(4, 12, 4, 6),
    child: Text(
      text,
      style: AppText.labelMedium.copyWith(color: AppColors.muted),
    ),
  );
}

class _ConversationTile extends StatelessWidget {
  const _ConversationTile({required this.c, required this.onTap});
  final SchoolChatConversation c;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tone = c.isGroup ? ModuleTone.blue : ModuleTone.green;
    return Card(
      child: ListTile(
        key: Key("school-chat-${c.id}"),
        leading: CircleAvatar(
          backgroundColor: tone.background,
          child: Icon(
            c.isGroup ? Icons.groups_outlined : Icons.person_outline,
            color: tone.foreground,
          ),
        ),
        title: Text(
          c.title,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          c.lastMessage ??
              (c.isGroup
                  ? context.l10n.schoolChatGroupNoMessages
                  : context.l10n.schoolChatNoMessages),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: AppText.bodySmallMuted,
        ),
        trailing: c.unread > 0
            ? CircleAvatar(
                radius: 11,
                backgroundColor: AppColors.danger,
                child: Text(
                  "${c.unread}",
                  style: AppText.labelSmall.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              )
            : const Icon(Icons.chevron_right, color: AppColors.muted),
        onTap: onTap,
      ),
    );
  }
}

/// One conversation: polled every 5 s while open.
class SchoolChatThreadScreen extends StatefulWidget {
  const SchoolChatThreadScreen({
    super.key,
    required this.api,
    required this.conversationId,
    required this.title,
    this.studentId,
    this.childName,
    this.isGroup = true,
    this.pollEvery = const Duration(seconds: 5),
  });

  final ApiClient api;
  final String conversationId;
  final String title;
  final String? studentId;
  final String? childName;
  final bool isGroup;
  final Duration pollEvery;

  @override
  State<SchoolChatThreadScreen> createState() => _SchoolChatThreadScreenState();
}

class _SchoolChatThreadScreenState extends State<SchoolChatThreadScreen> {
  final _controller = TextEditingController();
  final _scroll = ScrollController();
  SchoolChatThread? _thread;
  String? _error;
  String? _notice;
  bool _sending = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(widget.pollEvery, (_) => _load(quiet: true));
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load({bool quiet = false}) async {
    try {
      final t = await widget.api.fetchSchoolChatMessages(
        widget.conversationId,
        studentId: widget.studentId,
      );
      if (!mounted) return;
      final grew = (t.messages.length) != (_thread?.messages.length ?? -1);
      setState(() {
        _thread = t;
        _error = null;
      });
      if (grew) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_scroll.hasClients) {
            _scroll.jumpTo(_scroll.position.maxScrollExtent);
          }
        });
      }
    } on ApiException catch (e) {
      if (mounted && (!quiet || _thread == null)) {
        setState(() => _error = e.message);
      }
    } catch (_) {
      if (mounted && !quiet) {
        setState(() => _error = context.l10n.couldNotReachTheSchoolServer);
      }
    }
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() {
      _sending = true;
      _notice = null;
    });
    try {
      final r = await widget.api.sendSchoolChatMessage(
        conversationId: widget.conversationId,
        body: text,
        studentId: widget.studentId,
      );
      _controller.clear();
      if (mounted && r.held) setState(() => _notice = r.notice);
      await _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _notice = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _notice = context.l10n.couldNotSendCheckYourConnection);
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = _thread;
    final family = widget.studentId != null;
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.title, style: AppText.titleMedium),
            if (family)
              Text(
                widget.isGroup
                    ? l.schoolChatAsChild(widget.childName ?? "")
                    : l.schoolChatAsParent,
                style: AppText.labelMedium.copyWith(
                  color: const Color(0xFFB8C0D4),
                ),
              ),
          ],
        ),
      ),
      backgroundColor: AppColors.surface,
      body: Column(
        children: [
          Expanded(
            child: t == null
                ? Center(
                    child: _error == null
                        ? const CircularProgressIndicator(
                            color: AppColors.primary,
                          )
                        : Padding(
                            padding: const EdgeInsets.all(24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(
                                  Icons.cloud_off_outlined,
                                  size: 40,
                                  color: AppColors.muted,
                                ),
                                const SizedBox(height: 12),
                                Text(_error!, textAlign: TextAlign.center),
                                const SizedBox(height: 12),
                                FilledButton(
                                  onPressed: _load,
                                  child: Text(l.retry),
                                ),
                              ],
                            ),
                          ),
                  )
                : t.messages.isEmpty
                ? Center(
                    child: Text(
                      l.schoolChatNoMessages,
                      style: AppText.bodyMediumMuted,
                    ),
                  )
                : ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.all(14),
                    itemCount: t.messages.length,
                    itemBuilder: (context, i) => _Bubble(m: t.messages[i]),
                  ),
          ),
          if (_notice != null)
            Container(
              key: const Key("school-chat-notice"),
              width: double.infinity,
              color: AppColors.warning.withValues(alpha: 0.12),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              child: Text(_notice!, style: AppText.bodySmall),
            ),
          if (t != null && t.muted)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                l.schoolChatMuted,
                key: const Key("school-chat-muted"),
                style: AppText.bodySmall.copyWith(color: AppColors.danger),
              ),
            )
          else if (t != null && t.canSend)
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key("school-chat-input"),
                        controller: _controller,
                        minLines: 1,
                        maxLines: 4,
                        maxLength: 2000,
                        buildCounter:
                            (
                              _, {
                              required currentLength,
                              required isFocused,
                              maxLength,
                            }) => null,
                        textInputAction: TextInputAction.send,
                        onSubmitted: (_) => _send(),
                        decoration: InputDecoration(
                          hintText: l.typeAMessage,
                          filled: true,
                          fillColor: Colors.white,
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 10,
                          ),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(24),
                            borderSide: BorderSide.none,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton.filled(
                      key: const Key("school-chat-send"),
                      onPressed: _sending ? null : _send,
                      style: IconButton.styleFrom(
                        backgroundColor: AppColors.primary,
                      ),
                      icon: _sending
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(
                              Icons.send,
                              color: Colors.white,
                              size: 18,
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

class _Bubble extends StatelessWidget {
  const _Bubble({required this.m});
  final SchoolChatMessage m;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final mineVisible = m.mine && !m.held && !m.removed;
    final bg = m.held
        ? AppColors.warning.withValues(alpha: 0.14)
        : m.removed
        ? AppColors.muted.withValues(alpha: 0.12)
        : mineVisible
        ? AppColors.primary
        : Colors.white;
    final fg = mineVisible ? Colors.white : AppColors.ink;
    return Align(
      alignment: m.mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        key: Key("school-chat-msg-${m.id}"),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.78,
        ),
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(14),
          border: m.held ? Border.all(color: AppColors.warning) : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!m.mine)
              Text(
                m.senderLabel,
                style: AppText.labelSmall.copyWith(color: AppColors.accent),
              ),
            Text(
              m.removed ? l.schoolChatRemoved : m.body,
              style: AppText.bodyMedium.copyWith(
                color: fg,
                fontStyle: m.removed ? FontStyle.italic : null,
              ),
            ),
            if (m.held) ...[
              const SizedBox(height: 4),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.hourglass_top,
                    size: 14,
                    color: AppColors.warning,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    l.schoolChatWaiting,
                    style: AppText.labelSmall.copyWith(
                      color: AppColors.warning,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              if (m.notice != null)
                Text(
                  m.notice!,
                  style: AppText.labelSmall.copyWith(color: AppColors.ink),
                ),
            ],
            const SizedBox(height: 2),
            Text(
              formatTimeLabel(m.createdAt),
              style: AppText.labelSmall.copyWith(
                color: mineVisible ? Colors.white70 : AppColors.muted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The staff app's Messages: school chat, with the class teacher's inbox of
/// parent threads as the first row.
Widget staffSchoolChat(ApiClient api) => Builder(
  builder: (context) => SchoolChatScreen(
    api: api,
    classTeacherThread: (_) => ChatInboxScreen(api: api),
    classTeacherThreadLabel: context.l10n.schoolChatParentInbox,
  ),
);
