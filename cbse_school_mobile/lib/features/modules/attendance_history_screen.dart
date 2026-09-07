import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "module_shell.dart";
import "../../core/i18n/locale_controller.dart";

const _statusMeta = {
  "P": ("Present", AppColors.success),
  "A": ("Absent", AppColors.danger),
  "L": ("Late", AppColors.warning),
};

class AttendanceHistoryScreen extends StatelessWidget {
  const AttendanceHistoryScreen({
    super.key,
    required this.api,
    required this.child,
  });

  final ApiClient api;
  final ParentChild child;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<AttendanceHistory>(
      title: "Attendance",
      subtitle: child.fullName,
      load: () => api.fetchAttendanceHistory(child.id),
      emptyIcon: Icons.event_available_outlined,
      emptyText: context.l10n.noAttendanceMarkedYetThisTerm,
      isEmpty: (h) => h.entries.isEmpty,
      builder: (context, history, _) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              _StatCard(
                label: "Present",
                value: history.presentDays,
                color: AppColors.success,
              ),
              const SizedBox(width: 8),
              _StatCard(
                label: "Absent",
                value: history.absentDays,
                color: AppColors.danger,
              ),
              const SizedBox(width: 8),
              _StatCard(
                label: "Late",
                value: history.lateDays,
                color: AppColors.warning,
              ),
            ],
          ),
          const SizedBox(height: 14),
          Text(
            context.l10n.dayByDay,
            style: AppText.bodyLargeInk.copyWith(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
              child: Column(
                children: [
                  for (final e in history.entries)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 7),
                      child: Row(
                        children: [
                          Container(
                            width: 10,
                            height: 10,
                            decoration: BoxDecoration(
                              color:
                                  _statusMeta[e.status]?.$2 ?? AppColors.muted,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              formatDateLabel(e.date),
                              style: AppText.bodySmallInk,
                            ),
                          ),
                          Text(
                            _statusMeta[e.status]?.$1 ?? e.status,
                            style: AppText.labelLarge.copyWith(
                              color:
                                  _statusMeta[e.status]?.$2 ?? AppColors.muted,
                            ),
                          ),
                        ],
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

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final int value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Column(
            children: [
              Text(
                "$value",
                style: AppText.headlineSmall.copyWith(color: color),
              ),
              Text(label, style: AppText.labelMediumMuted),
            ],
          ),
        ),
      ),
    );
  }
}
