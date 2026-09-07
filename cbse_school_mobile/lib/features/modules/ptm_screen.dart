import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "module_shell.dart";
import "../../core/i18n/locale_controller.dart";

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
        title: Text(context.l10n.bookThisSlot, style: AppText.titleMedium),
        content: Text(
          "${event.name} — ${slot.teacherName}\n${formatDateLabel(event.date)}, ${formatTimeLabel(slot.startAt)}–${formatTimeLabel(slot.endAt)}\nfor ${child.fullName}",
          style: AppText.bodyMedium,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(context.l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(context.l10n.book),
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
      Haptics.success();
      await reload();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.slotBookedSeeYouThere)),
        );
      }
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
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
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(context.l10n.bookingCancelled)));
      }
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
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
                      style: AppText.bodyLargeInk.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      "${formatDateLabel(event.date)} · ${event.modeLabel}${event.note.isEmpty ? "" : "\n${event.note}"}",
                      style: AppText.bodySmallMuted,
                    ),
                    const SizedBox(height: 10),
                    if (event.myBookingId != null)
                      _BookedBanner(
                        event: event,
                        onCancel: () => _cancel(context, event, reload),
                      )
                    else ...[
                      Text(
                        context.l10n.chooseASlot,
                        style: AppText.labelLargeInk,
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
                                          style: AppText.labelLargeInk,
                                        ),
                                        Text(
                                          "${formatTimeLabel(slot.startAt)}–${formatTimeLabel(slot.endAt)}${slot.roomOrLink.isEmpty ? "" : " · ${slot.roomOrLink}"}",
                                          style: AppText.labelMediumMuted,
                                        ),
                                      ],
                                    ),
                                  ),
                                  Text(
                                    slot.seatsLeft > 0
                                        ? "${slot.seatsLeft} left"
                                        : "Full",
                                    style: AppText.labelMedium.copyWith(
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
              style: AppText.labelLarge.copyWith(
                color: ModuleTone.green.foreground,
              ),
            ),
          ),
          TextButton(onPressed: onCancel, child: Text(context.l10n.cancel)),
        ],
      ),
    );
  }
}
