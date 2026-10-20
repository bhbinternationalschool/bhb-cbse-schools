// Homework attachments on the staff app (request mr_mvajhg3w33lx, 20 Oct
// 2026): "Scan page" and "Upload file" on the compose form, files shrunk
// before upload, sent to POST /api/v1/staff/homework/attachment, their refs
// sent with the post, and every post's files shown to the reader (parent or
// teacher) on the homework card — the same for an app upload and a web one.
// The parent app must not gain the camera.
import "dart:convert";
import "dart:io";
import "dart:typed_data";

import "package:cbse_school_mobile/core/api/api_client.dart";
import "package:cbse_school_mobile/core/config/app_config.dart";
import "package:cbse_school_mobile/core/i18n/locale_controller.dart";
import "package:cbse_school_mobile/features/modules/homework_attachments.dart";
import "package:cbse_school_mobile/features/modules/homework_screen.dart";
import "package:cbse_school_mobile/l10n/app_localizations.dart";
import "package:flutter/material.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";
import "package:flutter_test/flutter_test.dart";
import "package:http/http.dart" as http;
import "package:http/testing.dart";
import "package:image/image.dart" as img;

const _config = AppConfig(
  apiBaseUrl: "https://erp.example.invalid",
  tenantSlug: "t",
  schoolName: "s",
  supabaseUrl: "",
  supabaseAnonKey: "",
);

JsonCache _memoryCache() =>
    JsonCache(baseDir: () async => throw const FileSystemException("test"));

Widget _app(Widget child) => LocaleScope(
  controller: LocaleController(),
  child: MaterialApp(
    localizationsDelegates: L.localizationsDelegates,
    supportedLocales: L.supportedLocales,
    home: child,
  ),
);

/// The feed as the server sends it: one post made in the app (a scanned
/// page), one made on the web (an inline file) — the same shape.
const _feed = {
  "posts": [
    {
      "id": "hw_app",
      "date": "2026-10-20",
      "title": "Ex 5.2",
      "bodyEn": "Q1-5",
      "subjectName": "Maths",
      "teacherName": "Asha",
      "attachmentCount": 1,
      "attachments": [
        {
          "id": "att_2026-10-20-abc",
          "label": "Page 1",
          "kind": "image",
          "url":
              "/api/v1/homework/attachment?postId=hw_app&attId=att_2026-10-20-abc",
        },
      ],
    },
    {
      "id": "hw_web",
      "date": "2026-10-19",
      "title": "Worksheet",
      "bodyEn": "",
      "subjectName": "English",
      "teacherName": "Ravi",
      "attachmentCount": 1,
      "attachments": [
        {
          "id": "att_1",
          "label": "sheet.pdf",
          "kind": "pdf",
          "url": "/api/v1/homework/attachment?postId=hw_web&attId=att_1",
        },
      ],
    },
  ],
  "diary": [],
  "subjects": [
    {"id": "sub_m", "name": "Maths"},
  ],
};

Uint8List _photo(int w, int h, {int orientation = 1}) {
  final im = img.Image(width: w, height: h);
  // A page-like gradient with grain, so JPEG has real work to do.
  var seed = 7;
  for (final p in im) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    final g = seed & 63;
    p
      ..r = (p.x * 255 ~/ w + g) % 256
      ..g = (p.y * 255 ~/ h + g) % 256
      ..b = (200 + g) % 256;
  }
  if (orientation != 1) im.exif.imageIfd.orientation = orientation;
  return Uint8List.fromList(img.encodeJpg(im, quality: 95));
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({
      "bhb_session_cookie": "cookie-A",
    });
  });

  group("shrink before upload", () {
    test("a big camera photo comes down to 1600px and about 600 KB", () {
      final raw = _photo(3200, 2400);
      final out = shrinkHomeworkFile(HomeworkFileBytes(raw, "image/jpeg"));
      final back = img.decodeImage(out.bytes)!;
      expect(out.mime, "image/jpeg");
      expect(back.width, 1600);
      expect(back.height, 1200);
      expect(out.bytes.length, lessThan(raw.length));
      expect(out.bytes.length, lessThanOrEqualTo(kHomeworkTargetBytes));
    });

    test("a sideways phone photo is turned upright", () {
      final raw = _photo(400, 200, orientation: 6);
      final out = shrinkHomeworkFile(HomeworkFileBytes(raw, "image/jpeg"));
      final back = img.decodeImage(out.bytes)!;
      expect([back.width, back.height], [200, 400]);
    });

    test("a small photo and a PDF go as they are", () {
      final small = Uint8List.fromList(
        img.encodeJpg(img.Image(width: 300, height: 200), quality: 80),
      );
      expect(
        identical(
          shrinkHomeworkFile(HomeworkFileBytes(small, "image/jpeg")).bytes,
          small,
        ),
        isTrue,
      );
      final pdf = Uint8List.fromList(utf8.encode("%PDF-1.4 fake"));
      final out = shrinkHomeworkFile(HomeworkFileBytes(pdf, "application/pdf"));
      expect(identical(out.bytes, pdf), isTrue);
      expect(out.mime, "application/pdf");
    });

    test("only photos and PDFs are accepted", () {
      expect(homeworkMimeOf("Page.JPG"), "image/jpeg");
      expect(homeworkMimeOf("sheet.pdf"), "application/pdf");
      expect(homeworkMimeOf("x", "image/webp"), "image/webp");
      expect(homeworkMimeOf("notes.docx"), isNull);
    });
  });

  group("api", () {
    test("feed: app-made and web-made files parse the same way", () {
      final feed = HomeworkFeed.fromJson(_feed);
      final app = feed.items.firstWhere((i) => i.title == "Ex 5.2");
      final web = feed.items.firstWhere((i) => i.title == "Worksheet");
      expect(app.attachments.single.label, "Page 1");
      expect(app.attachments.single.kind, "image");
      expect(web.attachments.single.isPdf, isTrue);
      expect(
        app.attachments.single.url,
        startsWith("/api/v1/homework/attachment?"),
      );
    });

    test(
      "upload goes to the staff route with the section; post carries the refs",
      () async {
        final seen = <http.BaseRequest>[];
        final bodies = <String>[];
        final server = MockClient((req) async {
          seen.add(req);
          bodies.add(req.body);
          if (req.url.path == "/api/v1/staff/homework/attachment") {
            return http.Response(
              jsonEncode({
                "data": {
                  "attachment": {
                    "id": "att_x",
                    "label": "Page 1",
                    "kind": "image",
                    "url": "/api/file/homework/c1/s1/2026-10-20-x.jpg",
                  },
                },
              }),
              200,
            );
          }
          return http.Response('{"data":{"postId":"hw_1"}}', 200);
        });
        await http.runWithClient(() async {
          final api = ApiClient(_config, cache: _memoryCache());
          final up = await api.uploadHomeworkAttachment(
            classId: "c1",
            sectionId: "s1",
            bytes: Uint8List.fromList([1, 2, 3]),
            fileName: "Page_1.jpg",
            mime: "image/jpeg",
            label: "Page 1",
          );
          expect(up.ref, "/api/file/homework/c1/s1/2026-10-20-x.jpg");
          await api.postHomework(
            classId: "c1",
            sectionId: "s1",
            subjectId: "sub_m",
            title: "t",
            bodyEn: "b",
            attachments: [up],
          );
        }, () => server);
        expect(seen.first.url.path, "/api/v1/staff/homework/attachment");
        expect(bodies.first, contains('name="classId"'));
        expect(bodies.first, contains('name="sectionId"'));
        final post = jsonDecode(bodies.last) as Map<String, dynamic>;
        expect(post["attachments"], [
          {
            "id": "att_x",
            "label": "Page 1",
            "url": "/api/file/homework/c1/s1/2026-10-20-x.jpg",
          },
        ]);
      },
    );
  });

  testWidgets(
    "the card shows each file; the compose form offers Scan page and Upload file",
    (tester) async {
      tester.view.physicalSize = const Size(420, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final server = MockClient(
        (req) async => http.Response(jsonEncode({"data": _feed}), 200),
      );
      await http.runWithClient(() async {
        await tester.pumpWidget(
          _app(
            HomeworkScreen(
              api: ApiClient(_config, cache: _memoryCache()),
              subtitle: "Class 5-A",
              classId: "c1",
              sectionId: "s1",
              canPost: true,
            ),
          ),
        );
        for (var i = 0; i < 10; i++) {
          await tester.pump(const Duration(milliseconds: 50));
        }
        expect(find.widgetWithText(ActionChip, "Page 1"), findsOneWidget);
        expect(find.widgetWithText(ActionChip, "sheet.pdf"), findsOneWidget);

        await tester.tap(find.byType(FloatingActionButton));
        for (var i = 0; i < 10; i++) {
          await tester.pump(const Duration(milliseconds: 50));
        }
        expect(find.text("Scan page"), findsOneWidget);
        expect(find.text("Upload file"), findsOneWidget);
      }, () => server);
    },
  );

  group("manifests", () {
    String read(String p) => File(p).readAsStringSync();

    test("the parent app removes CAMERA and the scanner's camera screen", () {
      final parent = read("android/app/src/parent/AndroidManifest.xml");
      expect(
        RegExp(
          r'android\.permission\.CAMERA"\s+tools:node="remove"',
        ).hasMatch(parent),
        isTrue,
      );
      expect(
        RegExp(
          r'<uses-permission android:name="android\.permission\.CAMERA"\s*/>',
        ).hasMatch(parent),
        isFalse,
      );
      expect(
        RegExp(
          r'DocumentScannerActivity"\s+tools:node="remove"',
        ).hasMatch(parent),
        isTrue,
      );
    });

    test(
      "the staff app asks for the camera; build.sh refuses it on parent",
      () {
        expect(
          read("android/app/src/staff/AndroidManifest.xml"),
          contains(
            '<uses-permission android:name="android.permission.CAMERA"/>',
          ),
        );
        expect(read("scripts/build.sh"), contains("CAMERA"));
        expect(read("ios/Runner/Info.plist"), contains("scan homework pages"));
      },
    );
  });
}
