import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";

/// School-wide WhatsApp + app-push broadcast for principal/owner roles —
/// the same choices as the web owner dashboard's Broadcast modal:
///
///  • **Approved template** (default when any exist): Meta delivers it to
///    every recipient regardless of the 24-hour session window.
///  • **Free text**: only reaches parents/staff who messaged the school's
///    WhatsApp number in the last 24 hours — Meta blocks the rest.
///
/// Two-step by design: the first tap is always a server dry-run that only
/// counts recipients; the live send needs a second, explicit confirmation
/// showing that count. The server itself also defaults to dry-run.
class BroadcastScreen extends StatefulWidget {
  const BroadcastScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<BroadcastScreen> createState() => _BroadcastScreenState();
}

class _BroadcastScreenState extends State<BroadcastScreen> {
  String _audience = "parents";
  final _body = TextEditingController();
  final Map<String, TextEditingController> _vars = {};

  List<WaBroadcastTemplate>? _templates; // null = loading
  String? _templatesError;
  /// null → free text
  WaBroadcastTemplate? _template;

  bool _busy = false;
  BroadcastResult? _preview;
  BroadcastResult? _sent;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadTemplates();
  }

  @override
  void dispose() {
    _body.dispose();
    for (final c in _vars.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _loadTemplates() async {
    try {
      final list = await widget.api.fetchBroadcastTemplates();
      if (!mounted) return;
      setState(() {
        _templates = list;
        // Templates reach everyone — make that the default when available.
        _selectTemplate(_pickDefault(list));
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _templates = const [];
          _templatesError = e.message;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _templates = const [];
          _templatesError = "Could not load templates — free text only.";
        });
      }
    }
  }

  /// Prefer an English broadcast-style template; skip the OTP one, which is
  /// approved but not something anyone broadcasts.
  WaBroadcastTemplate? _pickDefault(List<WaBroadcastTemplate> list) {
    final usable =
        list.where((t) => !t.metaName.toLowerCase().contains("otp")).toList();
    if (usable.isEmpty) return null;
    return usable.firstWhere((t) => t.language == "en", orElse: () => usable.first);
  }

  void _selectTemplate(WaBroadcastTemplate? t) {
    _template = t;
    _preview = null;
    _sent = null;
    _error = null;
    if (t != null) {
      for (final v in t.variables) {
        _vars.putIfAbsent(v.key, TextEditingController.new);
      }
    }
  }

  Map<String, String> _variableValues() {
    final t = _template;
    if (t == null) return const {};
    return {for (final v in t.variables) v.key: (_vars[v.key]?.text ?? "").trim()};
  }

  bool get _canPreview {
    final t = _template;
    if (t == null) return _body.text.trim().isNotEmpty;
    return t.variables.every((v) => (_vars[v.key]?.text ?? "").trim().isNotEmpty);
  }

  Future<void> _dryRun() async {
    if (!_canPreview) {
      setState(() => _error = _template == null
          ? "Type the message first."
          : "Fill every template field first.");
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _preview = null;
      _sent = null;
    });
    try {
      final r = await widget.api.ownerBroadcast(
        audience: _audience,
        body: _body.text.trim(),
        template: _template,
        variables: _variableValues(),
        dryRun: true,
      );
      if (mounted) setState(() => _preview = r);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = "Could not reach the school server.");
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendLive() async {
    final preview = _preview;
    if (preview == null) return;
    final who = _audience == "parents" ? "parent families" : "staff members";
    final viaTemplate = _template != null;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text("Send to everyone?"),
        content: Text(
          "This will send ${viaTemplate ? "the approved template “${_template!.name}”" : "your message"} "
          "on WhatsApp to ${preview.recipientCount} $who"
          "${preview.skippedOptOut > 0 ? " (${preview.skippedOptOut} opted out are skipped)" : ""}"
          " and as an app notification. This cannot be undone.",
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text("Cancel"),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text("Send to ${preview.recipientCount}"),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await widget.api.ownerBroadcast(
        audience: _audience,
        body: _body.text.trim(),
        template: _template,
        variables: _variableValues(),
        dryRun: false,
      );
      if (mounted) {
        setState(() {
          _sent = r;
          _preview = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = "Could not reach the school server.");
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _resetOutcome() {
    if (_preview != null || _sent != null) {
      setState(() {
        _preview = null;
        _sent = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final preview = _preview;
    final sent = _sent;
    final templates = _templates;
    final t = _template;
    return Scaffold(
      appBar: AppBar(title: const Text("Broadcast message")),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            "Audience",
            style: TextStyle(fontWeight: FontWeight.w600, color: AppColors.ink),
          ),
          const SizedBox(height: 6),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(
                value: "parents",
                label: Text("All parents"),
                icon: Icon(Icons.family_restroom_outlined),
              ),
              ButtonSegment(
                value: "staff",
                label: Text("All staff"),
                icon: Icon(Icons.badge_outlined),
              ),
            ],
            selected: {_audience},
            onSelectionChanged: _busy
                ? null
                : (s) => setState(() {
                      _audience = s.first;
                      _preview = null;
                      _sent = null;
                    }),
          ),
          const SizedBox(height: 16),
          const Text(
            "Message type",
            style: TextStyle(fontWeight: FontWeight.w600, color: AppColors.ink),
          ),
          const SizedBox(height: 6),
          if (templates == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  SizedBox(width: 10),
                  Text("Loading approved templates…",
                      style: TextStyle(fontSize: 12.5, color: AppColors.muted)),
                ],
              ),
            )
          else
            DropdownButtonFormField<String>(
              // Keyed on the selection so a programmatic change (default
              // template after load) re-seeds the field's initial value.
              key: ValueKey("tpl-${t?.id ?? ""}"),
              initialValue: t?.id ?? "",
              isExpanded: true,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                isDense: true,
              ),
              items: [
                const DropdownMenuItem(
                  value: "",
                  child: Text("Free text (24-hour window only)"),
                ),
                for (final tpl in templates)
                  DropdownMenuItem(
                    value: tpl.id,
                    child: Text(
                      "${tpl.name} (${tpl.language.toUpperCase()})",
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: _busy
                  ? null
                  : (id) => setState(() {
                        _selectTemplate(
                          id == null || id.isEmpty
                              ? null
                              : templates.firstWhere((x) => x.id == id),
                        );
                      }),
            ),
          if (_templatesError != null) ...[
            const SizedBox(height: 4),
            Text(_templatesError!,
                style: const TextStyle(fontSize: 11.5, color: AppColors.danger)),
          ],
          const SizedBox(height: 12),
          if (t != null) ...[
            Card(
              color: ModuleTone.teal.background,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      t.preview(_variableValues()),
                      style: const TextStyle(fontSize: 13, color: AppColors.ink),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      "Approved template · reaches every recipient regardless of the 24-hour window.",
                      style: TextStyle(
                          fontSize: 11, color: ModuleTone.teal.foreground),
                    ),
                  ],
                ),
              ),
            ),
            if (t.variables.isNotEmpty) ...[
              const SizedBox(height: 8),
              const Text(
                "The same value is used for every recipient — a school-wide send has no per-person data to fill placeholders with.",
                style: TextStyle(fontSize: 11.5, color: AppColors.muted),
              ),
              for (final v in t.variables)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: TextField(
                    controller: _vars[v.key],
                    enabled: !_busy,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: InputDecoration(
                      labelText: v.label,
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                    onChanged: (_) => setState(_resetOutcome),
                  ),
                ),
            ],
          ] else ...[
            TextField(
              controller: _body,
              enabled: !_busy,
              minLines: 4,
              maxLines: 10,
              maxLength: 1000,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: "Message",
                hintText:
                    "e.g. School will remain closed tomorrow on account of heavy rain. Classes resume Wednesday.",
                alignLabelWithHint: true,
                border: OutlineInputBorder(),
              ),
              onChanged: (_) => _resetOutcome(),
            ),
            const Text(
              "Free text only reaches recipients who messaged the school's WhatsApp "
              "number in the last 24 hours — Meta blocks it outside that window. "
              "Pick an approved template above to reach everyone.",
              style: TextStyle(fontSize: 11.5, color: AppColors.warning),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 6),
            Text(_error!,
                style: const TextStyle(color: AppColors.danger, fontSize: 12.5)),
          ],
          const SizedBox(height: 12),
          if (sent != null)
            Card(
              color: ModuleTone.teal.background,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.check_circle,
                            color: ModuleTone.teal.foreground),
                        const SizedBox(width: 8),
                        Text(
                          "Sent",
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: ModuleTone.teal.foreground,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      "WhatsApp: ${sent.sent} accepted by the gateway"
                      "${sent.failed > 0 ? ", ${sent.failed} failed" : ""}"
                      "${sent.skippedOptOut > 0 ? ", ${sent.skippedOptOut} opted out skipped" : ""}.\n"
                      "App notifications: ${sent.pushSent} sent.",
                      style: const TextStyle(fontSize: 12.5),
                    ),
                  ],
                ),
              ),
            )
          else if (preview != null)
            Card(
              color: ModuleTone.coral.background,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      "Ready to send to ${preview.recipientCount} "
                      "${_audience == "parents" ? "families" : "staff"}"
                      "${preview.skippedOptOut > 0 ? " (${preview.skippedOptOut} opted out will be skipped)" : ""}.",
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: ModuleTone.coral.foreground,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      "Nothing has been sent yet. Review the message above, then confirm.",
                      style: TextStyle(fontSize: 12, color: AppColors.muted),
                    ),
                    const SizedBox(height: 10),
                    FilledButton.icon(
                      onPressed: _busy ? null : _sendLive,
                      icon: const Icon(Icons.send),
                      label: Text("Send to ${preview.recipientCount} now"),
                    ),
                  ],
                ),
              ),
            )
          else
            FilledButton.tonalIcon(
              onPressed: _busy || templates == null ? null : _dryRun,
              icon: _busy
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.people_outline),
              label: const Text("Preview recipients"),
            ),
          const SizedBox(height: 16),
          const Text(
            "Goes out on WhatsApp from the school number and as a push notification "
            "to families/staff using the app. Parents who replied STOP are skipped "
            "automatically. Every send is logged in the ERP's household message log.",
            style: TextStyle(fontSize: 11.5, color: AppColors.muted),
          ),
        ],
      ),
    );
  }
}
