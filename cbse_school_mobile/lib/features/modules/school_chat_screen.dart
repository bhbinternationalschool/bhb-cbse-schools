import "dart:async";

import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "chat_inbox_screen.dart";
import "homework_screen.dart";
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

  /// Homework (the Homework screen's own compose — Scan page, Upload file),
  /// classwork or a notice. All three land in this chat; homework and
  /// classwork are the Homework module's records.
  Future<void> _postWork(SchoolChatCompose compose) async {
    final hindi = Localizations.localeOf(context).languageCode == "hi";
    final kind = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              key: const Key("school-chat-post-homework"),
              leading: const Icon(Icons.menu_book_outlined),
              title: Text(hindi ? "गृहकार्य" : "Homework"),
              subtitle: Text(
                hindi
                    ? "स्कैन, फ़ाइल, नियत तिथि"
                    : "Scan page, upload file, due date",
              ),
              onTap: () => Navigator.pop(context, "homework"),
            ),
            ListTile(
              key: const Key("school-chat-post-classwork"),
              leading: const Icon(Icons.edit_note_outlined),
              title: Text(hindi ? "कक्षा कार्य" : "Classwork"),
              onTap: () => Navigator.pop(context, "classwork"),
            ),
            ListTile(
              key: const Key("school-chat-post-notice"),
              leading: const Icon(Icons.campaign_outlined),
              title: Text(hindi ? "सूचना" : "Notice"),
              onTap: () => Navigator.pop(context, "notice"),
            ),
          ],
        ),
      ),
    );
    if (!mounted || kind == null) return;
    final parts = widget.conversationId.split(":");
    if (kind == "homework") {
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => HomeworkScreen(
            api: widget.api,
            subtitle: widget.title,
            classId: parts.length > 3 ? parts[2] : null,
            sectionId: parts.length > 3 ? parts[3] : null,
            canPost: true,
          ),
        ),
      );
      await _load();
      return;
    }
    final posted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _WorkSheet(
        api: widget.api,
        conversationId: widget.conversationId,
        kind: kind,
        compose: compose,
      ),
    );
    if (posted == true) await _load();
  }

  // ── A staff-made group's ⋮ menu (director, 30 Oct 2026) ──────────────

  bool get _hindi => Localizations.localeOf(context).languageCode == "hi";

  void _snack(String text) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  /// One change against the version last read. A refusal (403, 400, or 409
  /// when someone else changed the group first) is shown as the server
  /// worded it, and the group is read again.
  Future<bool> _change(
    String op, {
    String? title,
    List<String>? staffIds,
    ({String classId, String sectionId})? section,
    required String done,
  }) async {
    final m = _thread?.manage;
    if (m == null) return false;
    try {
      await widget.api.changeSchoolChatGroup(
        conversationId: widget.conversationId,
        rev: m.rev,
        op: op,
        title: title,
        staffIds: staffIds,
        section: section,
      );
      _snack(done);
      if (op != "leave") await _load();
      return true;
    } on ApiException catch (e) {
      _snack(e.message);
      await _load(quiet: true);
      return false;
    } catch (_) {
      if (mounted) _snack(context.l10n.couldNotReachTheSchoolServer);
      return false;
    }
  }

  Future<void> _rename() async {
    final controller = TextEditingController(text: _thread?.title ?? "");
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(_hindi ? "समूह का नाम" : "Edit name"),
        content: TextField(
          key: const Key("school-chat-group-name"),
          controller: controller,
          autofocus: true,
          maxLength: 120,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(_hindi ? "रद्द करें" : "Cancel"),
          ),
          FilledButton(
            key: const Key("school-chat-group-name-save"),
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: Text(_hindi ? "सहेजें" : "Save"),
          ),
        ],
      ),
    );
    if (name == null || name.isEmpty || name == _thread?.title) return;
    await _change(
      "rename",
      title: name,
      done: _hindi ? "नाम सहेजा गया।" : "Name saved.",
    );
  }

  Future<void> _members() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheet) => StatefulBuilder(
        builder: (sheet, setSheet) {
          final m = _thread?.manage;
          if (m == null) return const SizedBox.shrink();
          return SafeArea(
            child: ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.sizeOf(sheet).height * 0.8,
              ),
              child: ListView(
                key: const Key("school-chat-members"),
                shrinkWrap: true,
                padding: const EdgeInsets.symmetric(vertical: 8),
                children: [
                  ListTile(
                    title: Text(
                      "${_hindi ? "सदस्य" : "Staff in this group"} (${m.members.length})",
                      style: AppText.titleMedium,
                    ),
                  ),
                  if (m.creatorLeft)
                    Padding(
                      key: const Key("school-chat-creator-left"),
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                      child: Text(
                        "${m.creatorName.isEmpty ? "The staff member who made this group" : "${m.creatorName}, who made this group,"} has left it — only a chat moderator can change it now.",
                        style: AppText.bodySmall.copyWith(
                          color: AppColors.warning,
                        ),
                      ),
                    ),
                  for (final x in m.members)
                    ListTile(
                      dense: true,
                      title: Text(x.id == m.me ? "${x.name} (you)" : x.name),
                      trailing: m.canManage && x.id != m.me
                          ? IconButton(
                              key: Key("school-chat-remove-${x.id}"),
                              tooltip: "Remove ${x.name}",
                              icon: const Icon(
                                Icons.person_remove_outlined,
                                color: AppColors.danger,
                              ),
                              onPressed: m.members.length <= 2
                                  ? null
                                  : () async {
                                      final ok = await _confirm(
                                        "Remove ${x.name} from this group? They stop seeing it at once.",
                                      );
                                      if (!ok) return;
                                      await _change(
                                        "removeStaff",
                                        staffIds: [x.id],
                                        done: "${x.name} removed.",
                                      );
                                      setSheet(() {});
                                    },
                            )
                          : null,
                    ),
                  if (m.canManage && m.members.length <= 2)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                      child: Text(
                        "A group needs at least two staff — add someone before removing anyone.",
                        style: AppText.bodySmallMuted,
                      ),
                    ),
                  if (m.canManage)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                      child: OutlinedButton.icon(
                        key: const Key("school-chat-add-member"),
                        icon: const Icon(Icons.person_add_alt_1_outlined),
                        label: Text(_hindi ? "स्टाफ़ जोड़ें" : "Add staff"),
                        onPressed: () async {
                          await _addStaff();
                          setSheet(() {});
                        },
                      ),
                    ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Future<void> _addStaff() async {
    final m = _thread?.manage;
    if (m == null) return;
    SchoolChatGroupPicker picker;
    try {
      picker = await widget.api.fetchSchoolChatGroupPicker();
    } on ApiException catch (e) {
      _snack(e.message);
      return;
    }
    if (!mounted) return;
    final inGroup = m.members.map((x) => x.id).toSet();
    final options = picker.staff.where((s) => !inGroup.contains(s.id)).toList();
    final picked = await showModalBottomSheet<List<String>>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _StaffPickerSheet(staff: options),
    );
    if (picked == null || picked.isEmpty) return;
    await _change(
      "addStaff",
      staffIds: picked,
      done: picked.length == 1
          ? "1 person added."
          : "${picked.length} people added.",
    );
  }

  Future<void> _section() async {
    final m = _thread?.manage;
    if (m == null) return;
    SchoolChatGroupPicker picker;
    try {
      picker = await widget.api.fetchSchoolChatGroupPicker();
    } on ApiException catch (e) {
      _snack(e.message);
      return;
    }
    if (!mounted) return;
    // "" = staff only; else "classId|sectionId".
    final pick = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (sheet) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(sheet).height * 0.8,
          ),
          child: ListView(
            key: const Key("school-chat-sections"),
            shrinkWrap: true,
            children: [
              ListTile(
                title: Text(
                  _hindi ? "कक्षा अनुभाग" : "Class section",
                  style: AppText.titleMedium,
                ),
                subtitle: Text(
                  m.sectionLabel.isEmpty
                      ? "Now: staff only. A section's families can read the group (they cannot post)."
                      : "Now: ${m.sectionLabel} — its families can read the group.",
                ),
              ),
              if (m.sectionLabel.isNotEmpty)
                ListTile(
                  key: const Key("school-chat-section-clear"),
                  leading: const Icon(Icons.lock_outline),
                  title: const Text("Make staff only"),
                  onTap: () => Navigator.pop(sheet, ""),
                ),
              if (picker.sections.isEmpty)
                const ListTile(
                  title: Text("You can add only a class section you teach."),
                ),
              for (final sec in picker.sections)
                ListTile(
                  key: Key(
                    "school-chat-section-${sec.classId}-${sec.sectionId}",
                  ),
                  leading: const Icon(Icons.groups_outlined),
                  title: Text(sec.label),
                  onTap: () =>
                      Navigator.pop(sheet, "${sec.classId}|${sec.sectionId}"),
                ),
            ],
          ),
        ),
      ),
    );
    if (pick == null) return;
    if (pick.isEmpty) {
      await _change("clearSection", done: "The group is staff only now.");
      return;
    }
    final parts = pick.split("|");
    await _change(
      "setSection",
      section: (classId: parts[0], sectionId: parts[1]),
      done: "Class section saved.",
    );
  }

  Future<bool> _confirm(String text) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          content: Text(text),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(_hindi ? "रद्द करें" : "Cancel"),
            ),
            FilledButton(
              key: const Key("school-chat-confirm"),
              onPressed: () => Navigator.pop(context, true),
              child: const Text("OK"),
            ),
          ],
        ),
      ) ==
      true;

  Future<void> _leave() async {
    final m = _thread?.manage;
    if (m == null) return;
    final maker = m.canManage && !m.creatorLeft;
    final ok = await _confirm(
      "Leave \"${_thread?.title ?? widget.title}\"? You stop seeing it at once.${maker ? " If you made this group, only a chat moderator can change it after you leave." : ""}",
    );
    if (!ok) return;
    if (await _change("leave", done: "You left the group.") && mounted) {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = _thread;
    final family = widget.studentId != null;
    final manage = t?.manage;
    return Scaffold(
      appBar: AppBar(
        actions: [
          if (t?.compose != null)
            IconButton(
              key: const Key("school-chat-post-work"),
              tooltip: "Homework / classwork / notice",
              onPressed: () => _postWork(t!.compose!),
              icon: const Icon(Icons.post_add, color: Colors.white),
            ),
          if (manage != null)
            PopupMenuButton<String>(
              key: const Key("school-chat-group-menu"),
              tooltip: "Group menu",
              icon: const Icon(Icons.more_vert, color: Colors.white),
              onSelected: (v) {
                switch (v) {
                  case "name":
                    _rename();
                  case "members":
                    _members();
                  case "section":
                    _section();
                  case "leave":
                    _leave();
                }
              },
              itemBuilder: (_) => [
                if (manage.canManage)
                  PopupMenuItem(
                    value: "name",
                    child: Text(_hindi ? "नाम बदलें" : "Edit name"),
                  ),
                PopupMenuItem(
                  value: "members",
                  child: Text(
                    "${_hindi ? "सदस्य" : "Members"} (${manage.members.length})",
                  ),
                ),
                if (manage.canManage)
                  PopupMenuItem(
                    value: "section",
                    child: Text(_hindi ? "कक्षा अनुभाग" : "Class section"),
                  ),
                if (manage.canLeave)
                  PopupMenuItem(
                    value: "leave",
                    child: Text(
                      _hindi ? "समूह छोड़ें" : "Leave group",
                      style: const TextStyle(color: AppColors.danger),
                    ),
                  ),
              ],
            ),
        ],
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              (t?.title.isNotEmpty ?? false) ? t!.title : widget.title,
              style: AppText.titleMedium,
            ),
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
    if (m.system) {
      return Padding(
        key: Key("school-chat-note-${m.id}"),
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 24),
        child: Text(
          "${m.body} · ${formatTimeLabel(m.createdAt)}",
          textAlign: TextAlign.center,
          style: AppText.bodySmallMuted,
        ),
      );
    }
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
            if (m.card != null)
              _CardBody(card: m.card!, fg: fg)
            else if (m.isNotice) ...[
              Text(
                "NOTICE",
                key: const Key("school-chat-notice-card"),
                style: AppText.labelSmall.copyWith(
                  color: mineVisible ? Colors.white70 : AppColors.accent,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                m.body.substring(8),
                style: AppText.bodyMedium.copyWith(
                  color: fg,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ] else
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

/// A homework / classwork card in a bubble.
class _CardBody extends StatelessWidget {
  const _CardBody({required this.card, required this.fg});
  final SchoolChatCard card;
  final Color fg;

  @override
  Widget build(BuildContext context) {
    final hindi = Localizations.localeOf(context).languageCode == "hi";
    final head = card.isHomework
        ? (hindi ? "गृहकार्य" : "HOMEWORK")
        : (hindi ? "कक्षा कार्य" : "CLASSWORK");
    return Column(
      key: Key("school-chat-card-${card.refId}"),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          card.subject.isEmpty ? head : "$head · ${card.subject}",
          style: AppText.labelSmall.copyWith(
            color: fg.withValues(alpha: 0.8),
            fontWeight: FontWeight.w800,
          ),
        ),
        Text(
          card.title,
          style: AppText.bodyMedium.copyWith(
            color: fg,
            fontWeight: FontWeight.w700,
          ),
        ),
        if (card.body.isNotEmpty && card.body != card.title)
          Text(card.body, style: AppText.bodyMedium.copyWith(color: fg)),
        if (card.dueAt.isNotEmpty)
          Text(
            hindi ? "नियत: ${card.dueAt}" : "Due ${card.dueAt}",
            key: const Key("school-chat-card-due"),
            style: AppText.labelSmall.copyWith(
              color: fg,
              fontWeight: FontWeight.w700,
            ),
          ),
        if (card.attachments > 0)
          Text(
            hindi
                ? "${card.attachments} फ़ाइल — गृहकार्य में खोलें"
                : "${card.attachments} file${card.attachments == 1 ? "" : "s"} — open in Homework",
            style: AppText.labelSmall.copyWith(color: fg),
          ),
      ],
    );
  }
}

/// Classwork or a notice: a title and the details.
class _WorkSheet extends StatefulWidget {
  const _WorkSheet({
    required this.api,
    required this.conversationId,
    required this.kind,
    required this.compose,
  });
  final ApiClient api;
  final String conversationId;
  final String kind;
  final SchoolChatCompose compose;

  @override
  State<_WorkSheet> createState() => _WorkSheetState();
}

class _WorkSheetState extends State<_WorkSheet> {
  final _title = TextEditingController();
  final _body = TextEditingController();
  late String _subject = widget.compose.fixedSubject;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _post() async {
    if (_title.text.trim().isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.postSchoolChatWork(
        conversationId: widget.conversationId,
        kind: widget.kind,
        title: _title.text.trim(),
        body: _body.text.trim(),
        subjectId: _subject.isEmpty ? null : _subject,
      );
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = context.l10n.couldNotSendCheckYourConnection);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final notice = widget.kind == "notice";
    return Padding(
      padding: EdgeInsets.fromLTRB(
        16,
        16,
        16,
        16 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(notice ? "Notice" : "Classwork", style: AppText.titleMedium),
          if (!notice &&
              widget.compose.subjects.isNotEmpty &&
              widget.compose.fixedSubject.isEmpty)
            DropdownButton<String>(
              key: const Key("school-chat-work-subject"),
              isExpanded: true,
              value: _subject,
              items: [
                const DropdownMenuItem(value: "", child: Text("No subject")),
                for (final s in widget.compose.subjects)
                  DropdownMenuItem(value: s.id, child: Text(s.name)),
              ],
              onChanged: (v) => setState(() => _subject = v ?? ""),
            ),
          TextField(
            key: const Key("school-chat-work-title"),
            controller: _title,
            maxLength: 140,
            decoration: InputDecoration(
              labelText: notice ? "Notice title" : "What was done in class",
            ),
          ),
          TextField(
            key: const Key("school-chat-work-body"),
            controller: _body,
            minLines: 2,
            maxLines: 5,
            maxLength: 1800,
            decoration: const InputDecoration(labelText: "Details (optional)"),
          ),
          if (_error != null)
            Text(
              _error!,
              style: AppText.bodySmall.copyWith(color: AppColors.danger),
            ),
          const SizedBox(height: 8),
          FilledButton(
            key: const Key("school-chat-work-post"),
            onPressed: _busy ? null : _post,
            child: Text(_busy ? "Posting…" : "Post"),
          ),
        ],
      ),
    );
  }
}

/// Members → Add: the staff not yet in the group, with a search box.
class _StaffPickerSheet extends StatefulWidget {
  const _StaffPickerSheet({required this.staff});
  final List<({String id, String name})> staff;

  @override
  State<_StaffPickerSheet> createState() => _StaffPickerSheetState();
}

class _StaffPickerSheetState extends State<_StaffPickerSheet> {
  final _picked = <String>{};
  String _filter = "";

  @override
  Widget build(BuildContext context) {
    final f = _filter.trim().toLowerCase();
    final shown = widget.staff
        .where(
          (s) =>
              f.isEmpty ||
              s.name.toLowerCase().contains(f) ||
              _picked.contains(s.id),
        )
        .take(120)
        .toList();
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * 0.8,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: TextField(
                  key: const Key("school-chat-staff-search"),
                  decoration: const InputDecoration(
                    hintText: "Search staff",
                    prefixIcon: Icon(Icons.search),
                  ),
                  onChanged: (v) => setState(() => _filter = v),
                ),
              ),
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    for (final s in shown)
                      CheckboxListTile(
                        key: Key("school-chat-pick-${s.id}"),
                        dense: true,
                        value: _picked.contains(s.id),
                        title: Text(s.name),
                        onChanged: (v) => setState(
                          () => v == true
                              ? _picked.add(s.id)
                              : _picked.remove(s.id),
                        ),
                      ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    key: const Key("school-chat-add-picked"),
                    onPressed: _picked.isEmpty
                        ? null
                        : () => Navigator.pop(context, _picked.toList()),
                    child: Text(
                      _picked.isEmpty ? "Add" : "Add ${_picked.length}",
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
