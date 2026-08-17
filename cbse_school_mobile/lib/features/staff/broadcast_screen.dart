import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";

/// School-wide WhatsApp + app-push broadcast for principal/owner roles.
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
  bool _busy = false;
  BroadcastResult? _preview;
  BroadcastResult? _sent;
  String? _error;

  @override
  void dispose() {
    _body.dispose();
    super.dispose();
  }

  Future<void> _dryRun() async {
    final text = _body.text.trim();
    if (text.isEmpty) {
      setState(() => _error = "Type the message first.");
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _preview = null;
      _sent = null;
    });
    try {
      final r = await widget.api
          .ownerBroadcast(audience: _audience, body: text, dryRun: true);
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
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text("Send to everyone?"),
        content: Text(
          "This will send the message on WhatsApp to ${preview.recipientCount} $who"
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

  @override
  Widget build(BuildContext context) {
    final preview = _preview;
    final sent = _sent;
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
            onChanged: (_) {
              if (_preview != null || _sent != null) {
                setState(() {
                  _preview = null;
                  _sent = null;
                });
              }
            },
          ),
          if (_error != null) ...[
            const SizedBox(height: 4),
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
                      "WhatsApp: ${sent.sent} delivered to the gateway"
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
              onPressed: _busy ? null : _dryRun,
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
