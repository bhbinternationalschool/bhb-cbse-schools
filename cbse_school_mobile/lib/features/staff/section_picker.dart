import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";

/// Bottom sheet listing every class with its sections as chips; pops a
/// `(classId, sectionId, "Class Section")` record.
class SectionPicker extends StatelessWidget {
  const SectionPicker({super.key, required this.classes});

  final List<ClassRef> classes;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.6,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                "Choose class & section",
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 12),
              Expanded(
                child: ListView(
                  children: [
                    for (final c in classes)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(
                              width: 64,
                              child: Padding(
                                padding: const EdgeInsets.only(top: 8),
                                child: Text(
                                  c.name,
                                  style: const TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.ink,
                                  ),
                                ),
                              ),
                            ),
                            Expanded(
                              child: Wrap(
                                spacing: 8,
                                children: [
                                  for (final s in c.sections)
                                    ActionChip(
                                      label: Text(s.name),
                                      backgroundColor:
                                          ModuleTone.teal.background,
                                      labelStyle: TextStyle(
                                        color: ModuleTone.teal.foreground,
                                        fontWeight: FontWeight.w600,
                                      ),
                                      side: BorderSide.none,
                                      onPressed: () => Navigator.pop(
                                        context,
                                        (c.id, s.id, "${c.name} ${s.name}"),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
