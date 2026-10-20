import "package:flutter/material.dart";

import "../api/api_client.dart";

/// The signed-in person's notifications — the same list as the ERP bell
/// (GET /api/v1/notifications). Approvals, documents, messages, payments:
/// whatever concerns this person by their role. Tapping one marks it read
/// and hands its in-app route to [onOpenRoute] (the home opens it).
///
/// A failed read shows "Could not load" with Retry — never an empty list.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, required this.api, this.onOpenRoute});

  final ApiClient api;

  /// The home's router for an item's link ("/leave-approvals", "/fees", …).
  final void Function(String route)? onOpenRoute;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  NotifyInbox? _inbox;
  Object? _error;
  bool _loading = true;

  bool get _hindi => Localizations.localeOf(context).languageCode == "hi";

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final inbox = await widget.api.fetchNotifications();
      if (!mounted) return;
      setState(() {
        _inbox = inbox;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  Future<void> _open(NotifyItem n) async {
    if (n.unread) {
      try {
        await widget.api.markNotificationsRead([n.id]);
      } catch (_) {
        // Still open it; the next load shows it unread again.
      }
    }
    if (!mounted) return;
    final route = n.link;
    if (route.startsWith("/") &&
        route != "/notifications" &&
        widget.onOpenRoute != null) {
      Navigator.of(context).pop();
      widget.onOpenRoute!(route);
      return;
    }
    await _load();
  }

  Future<void> _markAll() async {
    try {
      await widget.api.markAllNotificationsRead();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("$e")));
    }
    await _load();
  }

  Future<void> _settings() async {
    final inbox = _inbox;
    if (inbox == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => NotificationSettingsScreen(
          api: widget.api,
          prefs: inbox.prefs,
          prefsRev: inbox.prefsRev,
        ),
      ),
    );
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final inbox = _inbox;
    return Scaffold(
      appBar: AppBar(
        title: Text(_hindi ? "सूचनाएँ" : "Notifications"),
        actions: [
          if (inbox != null && inbox.unread > 0)
            TextButton(
              key: const Key("notify-mark-all"),
              onPressed: _markAll,
              child: Text(_hindi ? "सब पढ़ा" : "Mark all read"),
            ),
          IconButton(
            key: const Key("notify-settings"),
            tooltip: _hindi ? "सेटिंग" : "Settings",
            icon: const Icon(Icons.tune),
            onPressed: inbox == null ? null : _settings,
          ),
        ],
      ),
      body: RefreshIndicator(onRefresh: _load, child: _body(inbox)),
    );
  }

  Widget _body(NotifyInbox? inbox) {
    if (_loading && inbox == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && inbox == null) {
      return ListView(
        children: [
          const SizedBox(height: 120),
          Center(
            child: Text(
              _hindi ? "सूचनाएँ लोड नहीं हुईं" : "Could not load notifications",
            ),
          ),
          const SizedBox(height: 12),
          Center(
            child: FilledButton(
              key: const Key("notify-retry"),
              onPressed: _load,
              child: Text(_hindi ? "फिर से" : "Retry"),
            ),
          ),
        ],
      );
    }
    final items = inbox?.items ?? const <NotifyItem>[];
    if (items.isEmpty) {
      return ListView(
        children: [
          const SizedBox(height: 120),
          Center(
            child: Text(_hindi ? "अभी कोई सूचना नहीं" : "No notifications yet"),
          ),
        ],
      );
    }
    return ListView.separated(
      itemCount: items.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final n = items[i];
        final scheme = Theme.of(context).colorScheme;
        return ListTile(
          key: Key("notify-item-${n.id}"),
          tileColor: n.unread
              ? scheme.primaryContainer.withValues(alpha: 0.25)
              : null,
          leading: Icon(
            _iconFor(n.topic),
            color: n.unread ? scheme.primary : scheme.onSurfaceVariant,
          ),
          title: Text(
            n.groupCount > 1
                ? "${n.titleFor(hindi: _hindi)}  ×${n.groupCount}"
                : n.titleFor(hindi: _hindi),
            style: TextStyle(
              fontWeight: n.unread ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
          subtitle: Text(
            [
              n.bodyFor(hindi: _hindi),
              notifyTopicLabel(n.topic, hindi: _hindi),
            ].where((s) => s.isNotEmpty).join("\n"),
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
          ),
          isThreeLine: true,
          trailing: n.unread
              ? Icon(
                  Icons.circle,
                  size: 10,
                  color: scheme.error,
                  semanticLabel: _hindi ? "नई" : "unread",
                )
              : null,
          onTap: () => _open(n),
        );
      },
    );
  }

  static IconData _iconFor(String topic) => switch (topic) {
    "approval" => Icons.how_to_reg_outlined,
    "leave" => Icons.event_busy_outlined,
    "document" => Icons.description_outlined,
    "message" => Icons.chat_bubble_outline,
    "fees" => Icons.currency_rupee,
    "homework" => Icons.menu_book_outlined,
    "attendance" => Icons.fact_check_outlined,
    _ => Icons.campaign_outlined,
  };
}

/// Mute a topic (it still shows in the list), voice on/off, quiet hours
/// (default 9 pm – 7 am: only urgent alerts ring). Saved on the server, so
/// the ERP and every phone of this person follow it.
class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({
    super.key,
    required this.api,
    required this.prefs,
    required this.prefsRev,
  });

  final ApiClient api;
  final NotifyPrefs prefs;
  final String? prefsRev;

  @override
  State<NotificationSettingsScreen> createState() =>
      _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState
    extends State<NotificationSettingsScreen> {
  late NotifyPrefs _p = widget.prefs;
  late String? _rev = widget.prefsRev;
  bool _saving = false;
  String _msg = "";

  bool get _hindi => Localizations.localeOf(context).languageCode == "hi";

  Future<void> _pickTime(bool start) async {
    final cur = start ? _p.quietStart : _p.quietEnd;
    final parts = cur.split(":");
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(
        hour: int.tryParse(parts[0]) ?? 21,
        minute: int.tryParse(parts[1]) ?? 0,
      ),
    );
    if (picked == null) return;
    final v =
        "${picked.hour.toString().padLeft(2, "0")}:${picked.minute.toString().padLeft(2, "0")}";
    setState(
      () => _p = start ? _p.copyWith(quietStart: v) : _p.copyWith(quietEnd: v),
    );
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _msg = "";
    });
    try {
      final rev = await widget.api.saveNotifyPrefs(_p, base: _rev);
      if (!mounted) return;
      setState(() {
        _rev = rev ?? _rev;
        _saving = false;
        _msg = _hindi ? "सहेजा गया" : "Saved";
      });
    } on NotifyPrefsConflict catch (c) {
      if (!mounted) return;
      setState(() {
        _p = c.prefs ?? _p;
        _rev = c.prefsRev;
        _saving = false;
        _msg = c.message;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _msg = "$e";
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_hindi ? "सूचना सेटिंग" : "Notification settings"),
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: Text(
              _hindi ? "इन पर फ़ोन बजे" : "Ring my phone for",
              style: Theme.of(context).textTheme.titleSmall,
            ),
          ),
          for (final t in kNotifyTopics)
            SwitchListTile(
              key: Key("notify-topic-${t.$1}"),
              title: Text(_hindi ? t.$3 : t.$2),
              value: !_p.mutedTopics.contains(t.$1),
              onChanged: (on) => setState(() {
                final muted = [..._p.mutedTopics]..remove(t.$1);
                if (!on) muted.add(t.$1);
                _p = _p.copyWith(mutedTopics: muted);
              }),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Text(
              _hindi
                  ? "बंद विषय सूची में फिर भी दिखेंगे।"
                  : "Switched-off topics still appear in the list.",
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          const Divider(),
          SwitchListTile(
            key: const Key("notify-voice"),
            title: Text(_hindi ? "बोलकर बताए (आवाज़)" : "Spoken alert"),
            subtitle: Text(
              _hindi ? "बंद = सामान्य आवाज़" : "Off = the phone's normal sound",
            ),
            value: _p.voice,
            onChanged: (v) => setState(() => _p = _p.copyWith(voice: v)),
          ),
          SwitchListTile(
            key: const Key("notify-quiet"),
            title: Text(_hindi ? "शांत समय" : "Quiet hours"),
            subtitle: Text(
              _hindi ? "केवल ज़रूरी सूचनाएँ बजेंगी" : "Only urgent alerts ring",
            ),
            value: _p.quietEnabled,
            onChanged: (v) => setState(() => _p = _p.copyWith(quietEnabled: v)),
          ),
          ListTile(
            key: const Key("notify-quiet-start"),
            enabled: _p.quietEnabled,
            title: Text(_hindi ? "से" : "From"),
            trailing: Text(_p.quietStart),
            onTap: () => _pickTime(true),
          ),
          ListTile(
            key: const Key("notify-quiet-end"),
            enabled: _p.quietEnabled,
            title: Text(_hindi ? "तक" : "Until"),
            trailing: Text(_p.quietEnd),
            onTap: () => _pickTime(false),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: Text(_msg, key: const Key("notify-settings-msg")),
                ),
                FilledButton(
                  key: const Key("notify-save"),
                  onPressed: _saving ? null : _save,
                  child: Text(_saving ? "…" : (_hindi ? "सहेजें" : "Save")),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
