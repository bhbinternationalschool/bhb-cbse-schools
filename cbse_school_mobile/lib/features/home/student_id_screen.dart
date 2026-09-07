import "package:flutter/material.dart";
import "package:qr_flutter/qr_flutter.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";

/// Digital student ID: the child's details and a QR of their admission
/// number, scannable at the gate, library, or fee counter into the ERP's
/// student search.
class StudentIdScreen extends StatelessWidget {
  const StudentIdScreen({
    super.key,
    required this.child,
    required this.guardianName,
  });

  final ParentChild child;
  final String guardianName;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Student ID", style: AppText.titleMedium),
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 380),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Image.asset(
                      "assets/images/logo-crest.png",
                      height: 64,
                      errorBuilder: (context, error, stack) =>
                          const SizedBox.shrink(),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      "BHB INTERNATIONAL SCHOOL",
                      textAlign: TextAlign.center,
                      style: AppText.bodyMedium.copyWith(
                        letterSpacing: 0.4,
                        color: AppColors.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 18),
                    CircleAvatar(
                      radius: 34,
                      backgroundColor: AppColors.accentSoft,
                      backgroundImage: child.photoUrl != null
                          ? NetworkImage(child.photoUrl!)
                          : null,
                      child: child.photoUrl == null
                          ? Text(
                              child.initials,
                              style: AppText.headlineMedium.copyWith(
                                color: AppColors.primary,
                              ),
                            )
                          : null,
                    ),
                    const SizedBox(height: 10),
                    Text(
                      child.fullName,
                      textAlign: TextAlign.center,
                      style: AppText.titleMediumInk.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(child.classLabel, style: AppText.bodySmallMuted),
                    if (guardianName.isNotEmpty)
                      Text(
                        "Guardian: $guardianName",
                        style: AppText.labelMediumMuted,
                      ),
                    const SizedBox(height: 18),
                    if (child.admissionNo.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Text(
                          "No admission number on record yet — contact the school office.",
                          textAlign: TextAlign.center,
                          style: AppText.bodySmallMuted,
                        ),
                      )
                    else ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFFE3E1D8)),
                        ),
                        child: QrImageView(
                          data: child.admissionNo,
                          version: QrVersions.auto,
                          size: 210,
                          gapless: true,
                          eyeStyle: const QrEyeStyle(
                            eyeShape: QrEyeShape.square,
                            color: AppColors.primary,
                          ),
                          dataModuleStyle: const QrDataModuleStyle(
                            dataModuleShape: QrDataModuleShape.square,
                            color: AppColors.primary,
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        child.admissionNo,
                        style: AppText.titleSmallInk.copyWith(
                          letterSpacing: 1.1,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        "Show this QR at the school gate, library or fee counter.",
                        textAlign: TextAlign.center,
                        style: AppText.labelMediumMuted,
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
