import "package:flutter/material.dart";
import "package:flutter/services.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../modules/module_shell.dart";
import "../../core/i18n/locale_controller.dart";

/// The gate, on the phone of whoever is standing at it.
///
/// Three things the guard does and nothing else: see who is on campus, let
/// somebody in, let somebody out. Early-pickup passes sit underneath, and
/// only for the people allowed to hand a child over.
class VisitorGateScreen extends StatelessWidget {
  const VisitorGateScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<GateBoard>(
      title: "Visitor gate",
      load: api.fetchGateBoard,
      emptyIcon: Icons.meeting_room_outlined,
      // Never "empty": an empty gate is a real, useful answer, and the
      // check-in button has to be reachable when nobody is on campus.
      builder: (context, board, reload) =>
          _Board(api: api, board: board, reload: reload),
    );
  }
}

class _Board extends StatelessWidget {
  const _Board({required this.api, required this.board, required this.reload});

  final ApiClient api;
  final GateBoard board;
  final Future<void> Function() reload;

  Future<void> _checkIn(BuildContext context) async {
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => _CheckInSheet(api: api, purposes: board.purposes),
    );
    if (done == true) await reload();
  }

  Future<void> _checkOut(BuildContext context, GateVisitor v) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dctx) => AlertDialog(
        title: Text(context.l10n.checkOut),
        content: Text(
          "${v.visitorName} came in at ${formatTimeLabel(v.inTime)}"
          "${v.personToMeet.isEmpty ? "" : " to meet ${v.personToMeet}"}.",
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dctx, false),
            child: Text(context.l10n.notYet),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dctx, true),
            child: Text(context.l10n.checkOut),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      final (_, alreadyOut) = await api.gateCheckOut(v.id);
      Haptics.success();
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            alreadyOut
                ? "${v.visitorName} was already checked out."
                : "${v.visitorName} checked out.",
          ),
        ),
      );
      await reload();
    } on ApiException catch (e) {
      Haptics.warning();
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _release(BuildContext context, GatePassRow p) async {
    final controller = TextEditingController();
    final who = await showDialog<String>(
      context: context,
      builder: (dctx) => AlertDialog(
        title: Text("Release ${p.studentName}"),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "${p.classLabel} · pass for ${p.requestedPickupTime.isEmpty ? p.date : p.requestedPickupTime}"
              "${p.reason.isEmpty ? "" : " · ${p.reason}"}"
              "${p.requestedBy.isEmpty ? "" : "\nApproved after ${p.requestedBy} raised it"}",
              style: AppText.bodySmallMuted,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              autofocus: true,
              textCapitalization: TextCapitalization.words,
              decoration: InputDecoration(
                labelText: context.l10n.whoIsCollectingTheChild,
                hintText: context.l10n.nameOfThePersonAtThe,
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dctx),
            child: Text(context.l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dctx, controller.text.trim()),
            child: Text(context.l10n.handOver),
          ),
        ],
      ),
    );
    if (who == null || who.isEmpty || !context.mounted) return;
    try {
      await api.releaseGatePass(id: p.id, pickedUpByName: who);
      Haptics.success();
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("${p.studentName} released to $who.")),
      );
      await reload();
    } on ApiException catch (e) {
      Haptics.warning();
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final passes = board.gatePasses;
    return Stack(
      children: [
        ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            Card(
              color: board.onCampus.isEmpty
                  ? ModuleTone.green.background
                  : ModuleTone.blue.background,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Text(
                  board.onCampus.isEmpty
                      ? "Nobody on campus right now."
                      : "${board.onCampus.length} on campus"
                            "${board.departedToday.isEmpty ? "" : " · ${board.departedToday.length} left today"}",
                  style: AppText.bodyMedium.copyWith(
                    color: board.onCampus.isEmpty
                        ? ModuleTone.green.foreground
                        : ModuleTone.blue.foreground,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
            if (board.onCampus.isNotEmpty) ...[
              const SizedBox(height: 12),
              const _Heading("On campus"),
              for (final v in board.onCampus)
                _VisitorCard(
                  visitor: v,
                  onCheckOut: () => _checkOut(context, v),
                ),
            ],
            if (passes.isNotEmpty) ...[
              const SizedBox(height: 16),
              _Heading(
                board.canRelease ? "Early pickup" : "Early pickup (view only)",
              ),
              for (final p in passes)
                _PassCard(
                  pass: p,
                  canRelease: board.canRelease,
                  onRelease: () => _release(context, p),
                ),
            ],
            if (board.departedToday.isNotEmpty) ...[
              const SizedBox(height: 16),
              const _Heading("Left today"),
              for (final v in board.departedToday)
                _VisitorCard(visitor: v, onCheckOut: null),
            ],
          ],
        ),
        Positioned(
          right: 16,
          bottom: 16,
          child: FloatingActionButton.extended(
            onPressed: () => _checkIn(context),
            icon: const Icon(Icons.person_add_alt_1),
            label: Text(context.l10n.checkIn),
          ),
        ),
      ],
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(
      text,
      style: AppText.bodyMediumInk.copyWith(fontWeight: FontWeight.w600),
    ),
  );
}

class _VisitorCard extends StatelessWidget {
  const _VisitorCard({required this.visitor, required this.onCheckOut});

  final GateVisitor visitor;
  final VoidCallback? onCheckOut;

  @override
  Widget build(BuildContext context) {
    final v = visitor;
    final since = v.onCampus
        ? "In ${formatTimeLabel(v.inTime)}"
        : "${formatTimeLabel(v.inTime)} → ${formatTimeLabel(v.outTime)}";
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: v.onCampus
              ? ModuleTone.blue.background
              : ModuleTone.green.background,
          child: Icon(
            v.onCampus ? Icons.login : Icons.logout,
            size: 20,
            color: v.onCampus
                ? ModuleTone.blue.foreground
                : ModuleTone.green.foreground,
          ),
        ),
        title: Text(
          v.visitorName,
          style: AppText.bodyMediumInk.copyWith(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          [
            "$since · ${v.purposeLabel}",
            if (v.linkedTo.isNotEmpty) v.linkedTo,
            if (v.personToMeet.isNotEmpty) "To meet ${v.personToMeet}",
            if (v.visitorNo.isNotEmpty) "${v.visitorNo} · ${v.mobile}",
          ].join("\n"),
          style: AppText.bodySmallMuted,
        ),
        isThreeLine: true,
        trailing: onCheckOut == null
            ? null
            : TextButton(onPressed: onCheckOut, child: Text(context.l10n.out)),
      ),
    );
  }
}

class _PassCard extends StatelessWidget {
  const _PassCard({
    required this.pass,
    required this.canRelease,
    required this.onRelease,
  });

  final GatePassRow pass;
  final bool canRelease;
  final VoidCallback onRelease;

  @override
  Widget build(BuildContext context) {
    final p = pass;
    final done = p.status == "picked_up";
    final tone = done
        ? ModuleTone.green
        : p.releasable
        ? ModuleTone.amber
        : ModuleTone.gray;
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: tone.background,
          child: Icon(
            done ? Icons.check : Icons.badge_outlined,
            size: 20,
            color: tone.foreground,
          ),
        ),
        title: Text(
          p.studentName.isEmpty ? p.studentId : p.studentName,
          style: AppText.bodyMediumInk.copyWith(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          [
            [
              if (p.classLabel.isNotEmpty) p.classLabel,
              if (p.requestedPickupTime.isNotEmpty) p.requestedPickupTime,
              p.statusLabel,
            ].join(" · "),
            if (p.reason.isNotEmpty) p.reason,
            if (done && p.pickedUpByName.isNotEmpty)
              "Collected by ${p.pickedUpByName}"
                  "${p.actualPickupTime.isEmpty ? "" : " at ${formatTimeLabel(p.actualPickupTime)}"}",
          ].join("\n"),
          style: AppText.bodySmallMuted,
        ),
        isThreeLine: true,
        trailing: canRelease && p.releasable
            ? FilledButton(
                onPressed: onRelease,
                child: Text(context.l10n.handOver),
              )
            : null,
      ),
    );
  }
}

/// Check-in. The mobile number is asked FIRST and looked up, because the
/// school usually already knows who this is — and a name it recognises is
/// worth more in the log than whatever was said at the gate.
class _CheckInSheet extends StatefulWidget {
  const _CheckInSheet({required this.api, required this.purposes});

  final ApiClient api;
  final List<({String value, String label})> purposes;

  @override
  State<_CheckInSheet> createState() => _CheckInSheetState();
}

class _CheckInSheetState extends State<_CheckInSheet> {
  final _mobile = TextEditingController();
  final _name = TextEditingController();
  final _meet = TextEditingController();
  final _idNote = TextEditingController();

  String _purpose = "";
  String _linkedTo = "";
  GateLookup? _lookup;
  bool _looking = false;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _purpose = widget.purposes.isEmpty ? "" : widget.purposes.first.value;
  }

  @override
  void dispose() {
    _mobile.dispose();
    _name.dispose();
    _meet.dispose();
    _idNote.dispose();
    super.dispose();
  }

  Future<void> _look() async {
    final m = _mobile.text.replaceAll(RegExp(r"\D"), "");
    if (m.length < 10) return;
    setState(() {
      _looking = true;
      _error = null;
    });
    try {
      final hit = await widget.api.lookupGateVisitor(
        m.substring(m.length - 10),
      );
      if (!mounted) return;
      setState(() {
        _lookup = hit;
        _linkedTo = hit.linkedTo;
        // Only fill a blank name — never overwrite what the guard typed.
        if (_name.text.trim().isEmpty && hit.suggestedName.isNotEmpty) {
          _name.text = hit.suggestedName;
        }
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _looking = false);
    }
  }

  Future<void> _checkOutOpen(GateVisitor open) async {
    setState(() => _saving = true);
    try {
      await widget.api.gateCheckOut(open.id);
      Haptics.success();
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      Haptics.warning();
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _saving = false;
      });
    }
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    final m = _mobile.text.replaceAll(RegExp(r"\D"), "");
    if (name.isEmpty) {
      setState(() => _error = "Enter the visitor's name");
      return;
    }
    if (m.length < 10) {
      setState(() => _error = "Enter a 10-digit mobile number");
      return;
    }
    if (_purpose.isEmpty) {
      setState(() => _error = "Pick why they are here");
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final (visitor, alreadyIn) = await widget.api.gateCheckIn(
        visitorName: name,
        mobile: m.substring(m.length - 10),
        purpose: _purpose,
        personToMeet: _meet.text.trim(),
        idProofNote: _idNote.text.trim(),
        linkedTo: _linkedTo,
      );
      Haptics.success();
      if (!mounted) return;
      Navigator.pop(context, true);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            alreadyIn
                ? "${visitor.visitorName} was already checked in at ${formatTimeLabel(visitor.inTime)}."
                : "${visitor.visitorName} checked in · ${visitor.visitorNo}",
          ),
        ),
      );
    } on ApiException catch (e) {
      Haptics.warning();
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final open = _lookup?.openVisit;
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              context.l10n.checkAVisitorIn,
              style: AppText.titleSmallInk.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _mobile,
              keyboardType: TextInputType.phone,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(12),
              ],
              decoration: InputDecoration(
                labelText: context.l10n.mobileNumber,
                suffixIcon: _looking
                    ? const Padding(
                        padding: EdgeInsets.all(12),
                        child: SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : IconButton(
                        icon: const Icon(Icons.search),
                        onPressed: _look,
                      ),
              ),
              onChanged: (v) {
                if (v.replaceAll(RegExp(r"\D"), "").length == 10) _look();
              },
            ),
            if (open != null) ...[
              const SizedBox(height: 12),
              Card(
                color: ModuleTone.amber.background,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "${open.visitorName} is already on campus since ${formatTimeLabel(open.inTime)}.",
                        style: AppText.labelLarge.copyWith(
                          color: ModuleTone.amber.foreground,
                        ),
                      ),
                      const SizedBox(height: 8),
                      FilledButton(
                        onPressed: _saving ? null : () => _checkOutOpen(open),
                        child: Text(context.l10n.checkThemOutInstead),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            if (_linkedTo.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                _linkedTo,
                style: AppText.labelLarge.copyWith(color: AppColors.primary),
              ),
            ],
            const SizedBox(height: 10),
            TextField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              decoration: InputDecoration(labelText: context.l10n.visitorSName),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _purpose.isEmpty ? null : _purpose,
              decoration: InputDecoration(
                labelText: context.l10n.whyAreTheyHere,
              ),
              items: [
                for (final p in widget.purposes)
                  DropdownMenuItem(value: p.value, child: Text(p.label)),
              ],
              onChanged: (v) => setState(() => _purpose = v ?? ""),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _meet,
              textCapitalization: TextCapitalization.words,
              decoration: InputDecoration(
                labelText: context.l10n.whoAreTheyHereToMeet,
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _idNote,
              decoration: InputDecoration(
                labelText: context.l10n.idShownOptional,
                hintText: context.l10n.aadhaarLastLicenceNo,
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(
                _error!,
                style: AppText.bodySmall.copyWith(color: AppColors.danger),
              ),
            ],
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: Text(_saving ? "Saving…" : "Check in"),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _saving ? null : () => Navigator.pop(context, false),
              child: Text(context.l10n.cancel),
            ),
          ],
        ),
      ),
    );
  }
}
