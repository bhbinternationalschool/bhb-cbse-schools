import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "chat_thread_screen.dart";
import "module_shell.dart";
import "../../core/i18n/locale_controller.dart";

/// Class teacher's inbox: one row per student in their section, threaded
/// into the same ChatThreadScreen the parent side uses.
class ChatInboxScreen extends StatelessWidget {
  const ChatInboxScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return ModuleShell<List<ChatThreadInfo>>(
      title: "Messages",
      load: api.fetchChatThreads,
      emptyIcon: Icons.chat_bubble_outline,
      emptyText: context.l10n.youReNotSetAsA,
      isEmpty: (threads) => threads.isEmpty,
      builder: (context, threads, reload) => ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(14),
        itemCount: threads.length,
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (context, i) {
          final t = threads[i];
          return Card(
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: ModuleTone.blue.background,
                child: Text(
                  t.studentName.isNotEmpty ? t.studentName[0] : "?",
                  style: TextStyle(
                    color: ModuleTone.blue.foreground,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              title: Text(
                t.studentName,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: Text(
                t.lastMessage ?? "No messages yet — say hello",
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppText.bodySmallMuted,
              ),
              trailing: t.unreadCount > 0
                  ? CircleAvatar(
                      radius: 10,
                      backgroundColor: AppColors.danger,
                      child: Text(
                        "${t.unreadCount}",
                        style: AppText.labelSmall.copyWith(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    )
                  : const Icon(Icons.chevron_right, color: AppColors.muted),
              onTap: () async {
                await Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => ChatThreadScreen(
                      api: api,
                      studentId: t.studentId,
                      studentName: t.studentName,
                    ),
                  ),
                );
                await reload();
              },
            ),
          );
        },
      ),
    );
  }
}
