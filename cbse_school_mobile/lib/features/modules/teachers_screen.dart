import "package:flutter/material.dart";
import "package:flutter_svg/flutter_svg.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../../core/ui/spacing.dart";
import "chat_thread_screen.dart";
import "module_shell.dart";

/// A child's teachers and how to reach them: the in-app chat for the
/// class teacher (always open — messages wait for the morning), and
/// WhatsApp for any teacher through the SCHOOL's number between 8 AM and
/// 8 PM. Teachers' own numbers are never shown.
class TeachersScreen extends StatelessWidget {
  const TeachersScreen({super.key, required this.api, required this.child});

  final ApiClient api;
  final ParentChild child;

  Future<void> _openWhatsApp(BuildContext context, String url) async {
    Haptics.tap();
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text("WhatsApp is not installed on this phone."),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return ModuleShell<TeacherContacts>(
      title: "Teachers",
      subtitle: child.fullName,
      load: () => api.fetchTeacherContacts(studentId: child.id),
      emptyIcon: Icons.school_outlined,
      emptyText:
          "No teachers are linked to this class yet. The school office assigns the class teacher and publishes the timetable.",
      isEmpty: (d) => d.teachers.isEmpty,
      builder: (context, d, _) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: Insets.page,
        children: [
          _HoursBanner(contacts: d),
          const SizedBox(height: Space.lg),
          for (final t in d.teachers) ...[
            _TeacherCard(
              teacher: t,
              open: d.hoursOpen,
              onChat: t.chatInApp
                  ? () {
                      Haptics.tap();
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => ChatThreadScreen(
                            api: api,
                            studentId: child.id,
                            studentName: child.fullName,
                          ),
                        ),
                      );
                    }
                  : null,
              onWhatsApp: t.waUrl.isEmpty
                  ? null
                  : () => _openWhatsApp(context, t.waUrl),
            ),
            const SizedBox(height: Space.sm),
          ],
          const SizedBox(height: Space.sm),
          Text(
            "WhatsApp messages go to the school's number (${d.schoolWhatsAppDisplay}) and are passed to the teacher — the message is already addressed, just type below the last line and send.\n"
            "व्हाट्सऐप संदेश स्कूल के नंबर पर जाता है और शिक्षक तक पहुँचाया जाता है — संदेश पहले से पता किया हुआ है, बस आख़िरी पंक्ति के नीचे लिखकर भेजें।",
            style: const TextStyle(
              fontSize: 11.5,
              color: AppColors.muted,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}

class _HoursBanner extends StatelessWidget {
  const _HoursBanner({required this.contacts});

  final TeacherContacts contacts;

  @override
  Widget build(BuildContext context) {
    final open = contacts.hoursOpen;
    final tone = open ? ModuleTone.green : ModuleTone.amber;
    return Container(
      padding: Insets.card,
      decoration: BoxDecoration(
        color: tone.background,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            open ? Icons.schedule : Icons.nightlight_outlined,
            color: tone.foreground,
            size: 22,
          ),
          const SizedBox(width: Space.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  open
                      ? "Teachers are available till 8 PM"
                      : "Teachers are available ${contacts.hoursLabel}",
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: tone.foreground,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  open
                      ? "शिक्षक रात 8 बजे तक उपलब्ध हैं।"
                      : "अभी शिक्षक उपलब्ध नहीं हैं (सुबह 8 – रात 8)। ऐप में भेजा संदेश सुरक्षित रहेगा और सुबह पहुँचेगा।",
                  style: TextStyle(
                    fontSize: 12.5,
                    color: tone.foreground,
                    height: 1.4,
                  ),
                ),
                if (!open) ...[
                  const SizedBox(height: 3),
                  Text(
                    contacts.hoursNote,
                    style: TextStyle(
                      fontSize: 12,
                      color: tone.foreground,
                      height: 1.4,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TeacherCard extends StatelessWidget {
  const _TeacherCard({
    required this.teacher,
    required this.open,
    required this.onChat,
    required this.onWhatsApp,
  });

  final TeacherContact teacher;
  final bool open;
  final VoidCallback? onChat;
  final VoidCallback? onWhatsApp;

  @override
  Widget build(BuildContext context) {
    final initials = teacher.name
        .split(" ")
        .where((p) => p.isNotEmpty)
        .take(2)
        .map((p) => p[0].toUpperCase())
        .join();
    return Card(
      child: Padding(
        padding: Insets.card,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 20,
                  backgroundColor: teacher.isClassTeacher
                      ? AppColors.primary
                      : ModuleTone.purple.background,
                  child: Text(
                    initials,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: teacher.isClassTeacher
                          ? Colors.white
                          : ModuleTone.purple.foreground,
                    ),
                  ),
                ),
                const SizedBox(width: Space.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        teacher.name,
                        style: const TextStyle(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                      Text(
                        teacher.role,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: Space.md),
            Row(
              children: [
                if (onChat != null) ...[
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: onChat,
                      icon: const Icon(Icons.chat_bubble_outline, size: 17),
                      label: const Text("Chat in app"),
                    ),
                  ),
                  const SizedBox(width: Space.sm),
                ],
                Expanded(
                  child: FilledButton.icon(
                    onPressed: onWhatsApp,
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF25D366),
                      disabledBackgroundColor: AppColors.ink.withValues(
                        alpha: 0.08,
                      ),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 11,
                      ),
                    ),
                    icon: SizedBox(
                      width: 18,
                      height: 18,
                      child: SvgPicture.asset(
                        "assets/icons/whatsapp.svg",
                        colorFilter: ColorFilter.mode(
                          onWhatsApp == null ? AppColors.muted : Colors.white,
                          BlendMode.srcIn,
                        ),
                      ),
                    ),
                    label: Text(open ? "WhatsApp" : "After 8 AM"),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
