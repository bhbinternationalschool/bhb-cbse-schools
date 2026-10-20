import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";

/// The signed text of one team change (the server's manageExtra in
/// app/api/public/survey-day): the op and its target, so a signature cannot
/// be lifted onto another change.
String surveyManageExtra(Map<String, dynamic> change) {
  final target = change["id"] ?? change["staffId"] ?? change["name"] ?? "";
  final s = "${change["op"] ?? ""}:$target";
  return s.length > 120 ? s.substring(0, 120) : s;
}

/// The survey team leader's screen (director, 15 Oct 2026): add or remove
/// staff on the team, add / edit / retire / reactivate beats. Every change
/// is one signed call; the server checks this phone is the leader's and
/// writes it through the write kernel, so the office's ERP screen shows it
/// within one poll and every surveyor's app on its next call.
class SurveyManageScreen extends StatefulWidget {
  const SurveyManageScreen({super.key, required this.call});

  /// "team" (read) or "manage" (one change) — signed by the caller.
  final Future<SurveyTeamInfo> Function(String action, [Map<String, dynamic>? change]) call;

  @override
  State<SurveyManageScreen> createState() => _SurveyManageScreenState();
}

class _SurveyManageScreenState extends State<SurveyManageScreen> {
  SurveyTeamInfo? _team;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final t = await widget.call("team");
      if (mounted) setState(() => _team = t);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = "Could not reach the school server.");
    }
  }

  Future<void> _change(Map<String, dynamic> change, String done) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final t = await widget.call("manage", change);
      if (!mounted) return;
      setState(() => _team = t);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      await _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Not saved — could not reach the school server.")),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addStaff(SurveyTeamInfo t) async {
    final picked = await showModalBottomSheet<({String id, String name, String empCode})>(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(c).height * 0.7,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text("Add to the survey team", style: AppText.titleMediumInk),
              ),
              Expanded(
                child: t.staff.isEmpty
                    ? const Center(child: Text("Everyone on the staff list is already on the team."))
                    : ListView(
                        children: [
                          for (final s in t.staff)
                            ListTile(
                              title: Text(s.name),
                              subtitle: Text(s.empCode),
                              trailing: const Icon(Icons.add_circle_outline),
                              onTap: () => Navigator.of(c).pop(s),
                            ),
                        ],
                      ),
              ),
            ],
          ),
        ),
      ),
    );
    if (picked != null) {
      await _change({"op": "member_add_staff", "staffId": picked.id}, "${picked.name} added to the team");
    }
  }

  Future<void> _beatDialog({
    ({String id, String code, String name, String area, int targetHouseholds, bool isActive, String revision})? beat,
  }) async {
    final name = TextEditingController(text: beat?.name ?? "");
    final area = TextEditingController(text: beat?.area ?? "");
    final target = TextEditingController(text: beat == null ? "50" : "${beat.targetHouseholds}");
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(beat == null ? "New beat" : "Edit ${beat.name}"),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(key: const Key("beat-name"), controller: name, decoration: const InputDecoration(labelText: "Beat name *")),
            TextField(controller: area, decoration: const InputDecoration(labelText: "Area / cluster")),
            TextField(
              controller: target,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: "Target households"),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(c).pop(false), child: const Text("Cancel")),
          FilledButton(onPressed: () => Navigator.of(c).pop(true), child: const Text("Save")),
        ],
      ),
    );
    if (ok != true) return;
    await _change(
      {
        "op": "beat_save",
        if (beat != null) "id": beat.id,
        if (beat != null) "base": beat.revision,
        "name": name.text.trim(),
        "area": area.text.trim(),
        "targetHouseholds": int.tryParse(target.text.trim()) ?? 0,
      },
      beat == null ? "Beat added: ${name.text.trim()}" : "Beat saved",
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = _team;
    return Scaffold(
      appBar: AppBar(title: const Text("Team & beats · टीम और बीट")),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            if (t == null && _error == null)
              const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator())),
            if (_error != null) ...[
              Text(_error!, style: AppText.bodyMedium.copyWith(color: AppColors.danger)),
              const SizedBox(height: 8),
              OutlinedButton(onPressed: _load, child: const Text("Try again")),
            ],
            if (t != null) ...[
              Row(
                children: [
                  Expanded(child: Text("Team · ${t.members.length}", style: AppText.titleMediumInk)),
                  FilledButton.icon(
                    key: const Key("survey-add-staff"),
                    icon: const Icon(Icons.person_add_alt_1_outlined),
                    onPressed: _busy ? null : () => _addStaff(t),
                    label: const Text("Add staff"),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              for (final m in t.members)
                Card(
                  child: ListTile(
                    dense: true,
                    title: Text(m.name + (m.isMe ? " (you)" : ""), style: AppText.bodyMediumInk),
                    subtitle: Text(
                      "${m.role == "leader" ? "Team leader" : "Surveyor"} · ${m.kind == "external" ? "outside" : m.empCode}",
                      style: AppText.bodySmallMuted,
                    ),
                    // A leader removes surveyors who are school staff; the
                    // office removes leaders and outside surveyors.
                    trailing: m.role == "leader" || m.isMe || m.kind != "staff"
                        ? null
                        : IconButton(
                            key: Key("remove-${m.id}"),
                            tooltip: "Remove from the team",
                            icon: const Icon(Icons.person_remove_outlined),
                            onPressed: _busy
                                ? null
                                : () async {
                                    final sure = await showDialog<bool>(
                                      context: context,
                                      builder: (c) => AlertDialog(
                                        title: Text("Remove ${m.name} from the survey team?"),
                                        actions: [
                                          TextButton(onPressed: () => Navigator.of(c).pop(false), child: const Text("Keep")),
                                          FilledButton(onPressed: () => Navigator.of(c).pop(true), child: const Text("Remove")),
                                        ],
                                      ),
                                    );
                                    if (sure == true) {
                                      await _change(
                                        {"op": "member_remove", "id": m.id, "base": m.revision},
                                        "${m.name} removed from the team",
                                      );
                                    }
                                  },
                          ),
                  ),
                ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(child: Text("Beats · ${t.beats.where((b) => b.isActive).length} active", style: AppText.titleMediumInk)),
                  FilledButton.icon(
                    key: const Key("survey-add-beat"),
                    icon: const Icon(Icons.add_location_alt_outlined),
                    onPressed: _busy ? null : () => _beatDialog(),
                    label: const Text("Add beat"),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              for (final b in t.beats)
                Card(
                  child: ListTile(
                    dense: true,
                    onTap: _busy ? null : () => _beatDialog(beat: b),
                    title: Text(
                      "${b.code} ${b.name}",
                      style: AppText.bodyMediumInk.copyWith(
                        decoration: b.isActive ? null : TextDecoration.lineThrough,
                      ),
                    ),
                    subtitle: Text(
                      "${b.area.isEmpty ? "—" : b.area} · target ${b.targetHouseholds}${b.isActive ? "" : " · retired"}",
                      style: AppText.bodySmallMuted,
                    ),
                    trailing: TextButton(
                      key: Key("beat-active-${b.id}"),
                      onPressed: _busy
                          ? null
                          : () => _change(
                              {"op": "beat_active", "id": b.id, "base": b.revision, "isActive": !b.isActive},
                              b.isActive ? "${b.name} retired" : "${b.name} back on",
                            ),
                      child: Text(b.isActive ? "Retire" : "Reactivate"),
                    ),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
