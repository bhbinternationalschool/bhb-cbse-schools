import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "module_shell.dart";

class PtmScreen extends StatelessWidget {
  const PtmScreen({super.key, required this.api, required this.child});

  final ApiClient api;
  final ParentChild child;

  Future<void> _book(
    BuildContext context,
    PtmEventInfo event,
    PtmSlotInfo slot,
    Future<void> Function() reload,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text("Book this slot?", style: TextStyle(fontSize: 16)),
        content: Text(
          "${event.name} — ${slot.teacherName}\n${formatDateLabel(event.date)}, ${formatTimeLabel(slot.startAt)}–${formatTimeLabel(slot.endAt)}\nfor ${child.fullName}",
          style: const TextStyle(fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text("Cancel"),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text("Book"),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await api.bookPtmSlot(
        eventId: event.id,
        slotId: slot.id,
        studentId: child.id,
      );
      await reload();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Slot booked — see you there!")),
        );
      }
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Future<void> _cancel(
    BuildContext context,
    PtmEventInfo event,
    Future<void> Function() reload,
  ) async {
    final bookingId = event.myBookingId;
    if (bookingId == null) return;
    try {
      await api.cancelPtmBooking(bookingId);
      await reload();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Booking cancelled")),
        );
      }
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<PtmEventInfo>>(
      title: "Parent-teacher meetings",
      subtitle: child.fullName,
      load: () => api.fetchPtmOverview(child.id),
      emptyIcon: Icons.groups_outlined,
      emptyText:
          "No PTM scheduled for ${child.fullName}'s class right now. Booking opens here when the school announces one.",
      isEmpty: (events) => events.isEmpty,
      builder: (context, events, reload) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          for (final event in events) ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      event.name,
                      style: const TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      "${formatDateLabel(event.date)} · ${event.modeLabel}${event.note.isEmpty ? "" : "\n${event.note}"}",
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.muted,
                      ),
                    ),
                    const SizedBox(height: 10),
                    if (event.myBookingId != null)
                      _BookedBanner(
                        event: event,
                        onCancel: () => _cancel(context, event, reload),
                      )
                    else ...[
                      const Text(
                        "Choose a slot",
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: 6),
                      for (final slot in event.slots)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 6),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(12),
                            onTap: slot.seatsLeft > 0
                                ? () => _book(context, event, slot, reload)
                                : null,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 10,
                              ),
                              decoration: BoxDecoration(
                                color: slot.seatsLeft > 0
                                    ? ModuleTone.teal.background
                                    : const Color(0xFFF0F0EC),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          slot.teacherName,
                                          style: const TextStyle(
                                            fontSize: 12.5,
                                            fontWeight: FontWeight.w600,
                                            color: AppColors.ink,
                                          ),
                                        ),
                                        Text(
                                          "${formatTimeLabel(slot.startAt)}–${formatTimeLabel(slot.endAt)}${slot.roomOrLink.isEmpty ? "" : " · ${slot.roomOrLink}"}",
                                          style: const TextStyle(
                                            fontSize: 11,
                                            color: AppColors.muted,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  Text(
                                    slot.seatsLeft > 0
                                        ? "${slot.seatsLeft} left"
                                        : "Full",
                                    style: TextStyle(
                                      fontSize: 11.5,
                                      fontWeight: FontWeight.w600,
                                      color: slot.seatsLeft > 0
                                          ? ModuleTone.teal.foreground
                                          : AppColors.muted,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _BookedBanner extends StatelessWidget {
  const _BookedBanner({required this.event, required this.onCancel});

  final PtmEventInfo event;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final slot = event.slots
        .where((s) => s.id == event.myBookingSlotId)
        .firstOrNull;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: ModuleTone.green.background,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(Icons.task_alt, size: 20, color: ModuleTone.green.foreground),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              slot == null
                  ? "Slot booked"
                  : "Booked — ${slot.teacherName}, ${formatTimeLabel(slot.startAt)}",
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: ModuleTone.green.foreground,
              ),
            ),
          ),
          TextButton(onPressed: onCancel, child: const Text("Cancel")),
        ],
      ),
    );
  }
}
