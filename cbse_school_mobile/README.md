# cbse_school_mobile

Flutter mobile app for **BHB International School ERP** — lives alongside `apps/web` in the monorepo.

## Prerequisites

- [Flutter SDK](https://docs.flutter.dev/get-started/install) (stable, Dart 3.12+)
- Xcode (iOS) and/or Android Studio (Android)

## Run locally

```bash
cd cbse_school_mobile
flutter pub get
flutter run
```

### Point at production API

```bash
flutter run \
  --dart-define=API_BASE_URL=https://bhbinternational.school \
  --dart-define=SUPABASE_URL=https://ymamhlcrjsuilzdonkzl.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=your_anon_key
```

## Project layout

```
lib/
  app/           # MaterialApp + go_router
  core/          # config, theme
  features/      # auth, home (expand per module)
  main.dart
```

## Next steps

1. Wire **Supabase Auth** + `/api/auth/session` (same flow as web `LoginPanel`)
2. Add staff vs parent personas and module screens
3. Reuse desk API routes under `/api/school-data/*`
4. Add secure token storage via `flutter_secure_storage`

## Push notifications (FCM)

- Firebase project = the GCP project `school-erp-prod-493619` (apps registered for
  Android `school.bhbinternational.cbse_school_mobile` and iOS
  `school.bhbinternational.cbseSchoolMobile`; config files are committed at
  `android/app/google-services.json` and `ios/Runner/GoogleService-Info.plist`).
- `lib/core/push/push_service.dart` initialises Firebase, asks permission after
  sign-in, uploads the token to `POST /api/v1/push/register` (unregisters on
  sign-out), renders foreground messages on Android via
  `flutter_local_notifications`, and turns a tap into an in-app deep link
  (`data.url`, e.g. `/homework`, `/chat?studentId=…`) consumed by the home screens.
- Server side: `apps/web/src/lib/fcm.server.ts` (FCM HTTP v1 via ADC) fanned into
  `sendPushToSubject()` next to Web Push, so every trigger reaches PWA + app.
- iOS still needs an APNs key uploaded in Firebase console → Cloud Messaging and
  the `aps-environment` entitlement flipped to `production` for TestFlight/App
  Store builds.

## Bundle id

- Android/iOS: `school.bhbinternational.cbse_school_mobile`
