import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../modules/module_shell.dart";

/// What this cashier has taken today, receipt by receipt — the sheet they
/// hand over with the cash box.
class MyCollectionsScreen extends StatelessWidget {
  const MyCollectionsScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<DayCollections>(
      title: "My collections",
      load: () => api.fetchMyCollections(),
      emptyIcon: Icons.account_balance_wallet_outlined,
      emptyText: "You have not collected anything today.",
      isEmpty: (d) => d.receipts.isEmpty,
      builder: (context, d, _) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            color: ModuleTone.teal.background,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    d.totalLabel,
                    style: AppText.headlineLarge.copyWith(
                      color: ModuleTone.teal.foreground,
                    ),
                  ),
                  Text(
                    "${d.count} receipt${d.count == 1 ? "" : "s"} · ${formatDateLabel(d.date)}",
                    style: AppText.bodySmallMuted,
                  ),
                  if (d.byMode.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Wrap(
                        spacing: 8,
                        children: [
                          for (final m in d.byMode)
                            Chip(
                              label: Text(
                                "${m.mode} ${m.label}",
                                style: AppText.labelMedium,
                              ),
                              backgroundColor: Colors.white,
                              side: BorderSide.none,
                            ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          for (final r in d.receipts)
            Card(
              child: ListTile(
                dense: true,
                leading: CircleAvatar(
                  radius: 18,
                  backgroundColor: ModuleTone.green.background,
                  child: Icon(
                    Icons.receipt_outlined,
                    size: 18,
                    color: ModuleTone.green.foreground,
                  ),
                ),
                title: Text(
                  r.receiptNo,
                  style: AppText.bodyMediumInk.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                subtitle: Text(
                  "${r.guardianName}${r.studentNames.isEmpty ? "" : " · ${r.studentNames}"}\n${r.modes.join(", ")}${r.collectedAt.isEmpty ? "" : " · ${formatTimeLabel(r.collectedAt)}"}",
                  style: AppText.labelMediumMuted,
                ),
                isThreeLine: true,
                trailing: Text(
                  r.totalLabel,
                  style: AppText.bodyLargeInk.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
