import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "module_shell.dart";

class FeesScreen extends StatelessWidget {
  const FeesScreen({super.key, required this.api, required this.child});

  final ApiClient api;
  final ParentChild child;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<FeeLedger>(
      title: "Fees",
      subtitle: child.fullName,
      load: () => api.fetchFeeLedger(child.id),
      emptyIcon: Icons.task_alt,
      emptyText: "No pending fees — all dues are cleared. Thank you!",
      isEmpty: (ledger) => ledger.openDues.isEmpty,
      builder: (context, ledger, _) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            color: AppColors.primary,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  const Expanded(
                    child: Text(
                      "Total due",
                      style: TextStyle(color: Color(0xFFB8C0D4), fontSize: 13),
                    ),
                  ),
                  Text(
                    ledger.openBalanceLabel,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          for (final due in ledger.openDues)
            Card(
              child: ListTile(
                dense: true,
                title: Text(
                  due.label,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                subtitle: due.dueOn.isEmpty
                    ? null
                    : Text(
                        "Due ${formatDateLabel(due.dueOn)}",
                        style: const TextStyle(
                          fontSize: 11.5,
                          color: AppColors.muted,
                        ),
                      ),
                trailing: Text(
                  due.balanceLabel,
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
            ),
          const SizedBox(height: 12),
          const Card(
            child: Padding(
              padding: EdgeInsets.all(14),
              child: Row(
                children: [
                  Icon(Icons.info_outline, size: 18, color: AppColors.muted),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      "Fees can be paid at the school office (cash, UPI or cheque). Online payment from the app is coming soon.",
                      style: TextStyle(fontSize: 12, color: AppColors.muted),
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
