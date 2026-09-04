import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "bus_routes_screen.dart";
import "module_shell.dart";

/// The family's school transport: for each child, the bus they ride —
/// route, stop, vehicle, driver with a call button — or, if they do not,
/// the state of their transport request, or a way to make one.
class TransportScreen extends StatelessWidget {
  const TransportScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<MyTransport>(
      title: "Transport",
      load: api.fetchMyTransport,
      builder: (context, mine, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          for (final child in mine.children)
            _ChildCard(api: api, child: child, mine: mine, reload: reload),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => BusRoutesScreen(api: api)),
            ),
            icon: const Icon(Icons.map_outlined, size: 18),
            label: const Text("See all bus routes and stops"),
          ),
        ],
      ),
    );
  }
}

class _ChildCard extends StatelessWidget {
  const _ChildCard({
    required this.api,
    required this.child,
    required this.mine,
    required this.reload,
  });

  final ApiClient api;
  final ChildTransportInfo child;
  final MyTransport mine;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final t = child.transport;
    final r = child.request;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              child.fullName,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
            Text(
              child.classLabel,
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
            const SizedBox(height: 10),
            if (t != null) ...[
              _Row(Icons.alt_route, "Bus ${t.routeCode} · ${t.routeName}"),
              _Row(
                Icons.place_outlined,
                "Stop: ${t.stopName.isEmpty ? "—" : t.stopName}",
              ),
              _Row(
                Icons.directions_bus_outlined,
                [
                  t.vehicleName,
                  t.vehicleReg,
                ].where((x) => x.isNotEmpty).toSet().join(" · "),
              ),
              _Row(Icons.schedule_outlined, switch (t.serviceMode) {
                "pickup" => "Morning pickup only",
                "drop" => "Afternoon drop only",
                _ => "Pickup and drop",
              }),
              if (t.monthlyFeeLabel.isNotEmpty && t.monthlyFeeLabel != "₹0")
                _Row(Icons.payments_outlined, "${t.monthlyFeeLabel} per month"),
              if (t.suspended)
                const Padding(
                  padding: EdgeInsets.only(top: 6),
                  child: Text(
                    "Boarding is paused by the office at the moment.",
                    style: TextStyle(fontSize: 12, color: AppColors.warning),
                  ),
                ),
              const SizedBox(height: 8),
              if (t.driverName.isNotEmpty || t.canCallDriver)
                Row(
                  children: [
                    const Icon(
                      Icons.person_outline,
                      size: 18,
                      color: AppColors.muted,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        "Driver: ${t.driverName.isEmpty ? "—" : t.driverName}",
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.ink,
                        ),
                      ),
                    ),
                    if (t.canCallDriver)
                      FilledButton.icon(
                        onPressed: () => _call(context, t.driverMobile),
                        icon: const Icon(Icons.call, size: 18),
                        label: const Text("Call"),
                      ),
                  ],
                )
              else
                const Text(
                  "Driver's number is not on the school's record yet.",
                  style: TextStyle(fontSize: 12, color: AppColors.muted),
                ),
            ] else ...[
              const Text(
                "Not using school transport.",
                style: TextStyle(fontSize: 13, color: AppColors.ink),
              ),
              const SizedBox(height: 8),
              if (r != null && r.isActive) ...[
                _StatusLine(r),
                const SizedBox(height: 4),
                const Text(
                  "The transport in-charge will call you about the stop and the fee.",
                  style: TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ] else ...[
                if (r != null) ...[_StatusLine(r), const SizedBox(height: 6)],
                Align(
                  alignment: Alignment.centerRight,
                  child: FilledButton.icon(
                    onPressed: () => _request(context),
                    icon: const Icon(Icons.directions_bus_outlined, size: 18),
                    label: Text(
                      r == null ? "Request school transport" : "Request again",
                    ),
                  ),
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _call(BuildContext context, String mobile) async {
    final digits = mobile.replaceAll(RegExp(r"\D"), "");
    final ok = await launchUrl(Uri.parse("tel:$digits"));
    if (!ok && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text("Could not start a call. The number is $mobile."),
        ),
      );
    }
  }

  Future<void> _request(BuildContext context) async {
    final sent = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => _RequestForm(api: api, child: child, mine: mine),
    );
    if (sent == true) {
      Haptics.success();
      await reload();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text("Request sent. The school will get in touch."),
          ),
        );
      }
    }
  }
}

class _StatusLine extends StatelessWidget {
  const _StatusLine(this.r);

  final TransportRequestState r;

  @override
  Widget build(BuildContext context) {
    final (label, tone) = switch (r.status) {
      "contacted" => ("Office has been in touch", ModuleTone.blue),
      "assigned" => (
        "Assigned — bus details will appear here",
        ModuleTone.green,
      ),
      "declined" => ("Not possible right now", ModuleTone.coral),
      _ => ("Request sent — waiting for the office", ModuleTone.amber),
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: tone.background,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: tone.foreground,
            ),
          ),
        ),
        if (r.handlingNote.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              "School: ${r.handlingNote}",
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          ),
      ],
    );
  }
}

class _Row extends StatelessWidget {
  const _Row(this.icon, this.text);

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.muted),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(fontSize: 13, color: AppColors.ink),
            ),
          ),
        ],
      ),
    );
  }
}

class _RequestForm extends StatefulWidget {
  const _RequestForm({
    required this.api,
    required this.child,
    required this.mine,
  });

  final ApiClient api;
  final ChildTransportInfo child;
  final MyTransport mine;

  @override
  State<_RequestForm> createState() => _RequestFormState();
}

class _RequestFormState extends State<_RequestForm> {
  late final _address = TextEditingController(text: widget.mine.address);
  late final _locality = TextEditingController(text: widget.mine.locality);
  late final _landmark = TextEditingController(text: widget.mine.landmark);
  final _stop = TextEditingController();
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_address, _locality, _landmark, _stop, _note]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _send() async {
    if (_busy) return;
    if (_address.text.trim().isEmpty) {
      Haptics.warning();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Please give the pickup address.")),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      await widget.api.requestTransport(
        studentId: widget.child.id,
        pickupAddress: _address.text.trim(),
        locality: _locality.text.trim(),
        landmark: _landmark.text.trim(),
        preferredStop: _stop.text.trim(),
        note: _note.text.trim(),
      );
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Could not reach the school server.")),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inset = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + inset),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              "School transport for ${widget.child.fullName}",
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              "Tell the school where to pick up from. The transport in-charge "
              "will call to confirm the stop and the monthly fee.",
              style: TextStyle(
                fontSize: 12,
                color: AppColors.muted,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _address,
              maxLines: 2,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: "Pickup address"),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _locality,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: "Locality / village",
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _landmark,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: "Landmark"),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _stop,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: "Preferred stop (if you know one)",
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _note,
              maxLines: 2,
              maxLength: 500,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: "Anything else"),
            ),
            const SizedBox(height: 4),
            FilledButton(
              onPressed: _busy ? null : _send,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(46),
              ),
              child: Text(_busy ? "Sending…" : "Send request"),
            ),
          ],
        ),
      ),
    );
  }
}
