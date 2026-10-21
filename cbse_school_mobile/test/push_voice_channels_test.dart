import "dart:io";

import "package:cbse_school_mobile/core/push/push_service.dart";
import "package:flutter_local_notifications/flutter_local_notifications.dart";
import "package:flutter_test/flutter_test.dart";

/// Records the channel calls PushService makes at start-up.
class _FakeAndroid extends AndroidFlutterLocalNotificationsPlugin {
  final created = <AndroidNotificationChannel>[];
  final deleted = <String>[];
  final order = <String>[];

  @override
  Future<void> createNotificationChannel(AndroidNotificationChannel c) async {
    created.add(c);
    order.add("create:${c.id}");
  }

  @override
  Future<void> deleteNotificationChannel(String channelId) async {
    deleted.add(channelId);
    order.add("delete:$channelId");
  }
}

void main() {
  // 21 Oct 2026: build 1.0.33+34 shipped placeholder approval/document clips;
  // Android keeps a channel's first sound, so those lines moved to `_v2` ids.
  group("voice channels", () {
    late _FakeAndroid android;
    setUp(() async {
      android = _FakeAndroid();
      await PushService.setUpVoiceChannels(android, "desc");
    });

    AndroidNotificationChannel channel(String id) => android.created.firstWhere(
      (c) => c.id == id,
      orElse: () {
        fail("channel $id was not created");
      },
    );

    test("approval and document get v2 channels with their real clips", () {
      for (final kind in ["approval", "document"]) {
        for (final lang in ["hi", "en"]) {
          final c = channel("bhb_voice_${kind}_${lang}_v2");
          expect(c.playSound, isTrue);
          expect(c.importance, Importance.high);
          final sound = c.sound as RawResourceAndroidNotificationSound;
          expect(sound.sound, "bhb_voice_${kind}_$lang");
          expect(
            File(
              "android/app/src/main/res/raw/bhb_voice_${kind}_$lang.m4a",
            ).existsSync(),
            isTrue,
            reason: "the v2 channel's clip must exist in res/raw",
          );
        }
      }
    });

    test("the placeholder channels are deleted and never re-created", () {
      const old = [
        "bhb_voice_approval_hi",
        "bhb_voice_approval_en",
        "bhb_voice_document_hi",
        "bhb_voice_document_en",
      ];
      expect(android.deleted.toSet(), old.toSet());
      for (final id in old) {
        expect(android.created.any((c) => c.id == id), isFalse, reason: id);
      }
    });

    test("every other voice channel keeps its id and sound", () {
      for (final kind in [
        "homework",
        "attendance",
        "fees",
        "message",
        "leave",
        "notice",
      ]) {
        for (final lang in ["hi", "en"]) {
          final id = "bhb_voice_${kind}_$lang";
          final c = channel(id);
          expect((c.sound as RawResourceAndroidNotificationSound).sound, id);
          expect(android.deleted, isNot(contains(id)));
        }
      }
      expect(android.created.length, 16);
      expect(android.deleted, isNot(contains("bhb_default")));
    });

    test("channel ids and clip names map both ways", () {
      expect(
        PushService.voiceChannelId("approval", "en"),
        "bhb_voice_approval_en_v2",
      );
      expect(PushService.voiceChannelId("fees", "hi"), "bhb_voice_fees_hi");
      expect(
        PushService.voiceSoundOf("bhb_voice_document_hi_v2"),
        "bhb_voice_document_hi",
      );
      expect(
        PushService.voiceSoundOf("bhb_voice_fees_hi"),
        "bhb_voice_fees_hi",
      );
    });
  });
}
