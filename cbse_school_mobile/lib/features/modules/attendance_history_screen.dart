import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "module_shell.dart";

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
      emptyText:
          "No attendance marked yet this term. Records appear here the day the class teacher marks the register.",
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
          const Text(
            "Day by day",
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
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
                              color: _statusMeta[e.status]?.$2 ??
                                  AppColors.muted,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              formatDateLabel(e.date),
                              style: const TextStyle(
                                fontSize: 12.5,
                                color: AppColors.ink,
                              ),
                            ),
                          ),
                          Text(
                            _statusMeta[e.status]?.$1 ?? e.status,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
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
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
              ),
              Text(
                label,
                style: const TextStyle(fontSize: 11, color: AppColors.muted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
