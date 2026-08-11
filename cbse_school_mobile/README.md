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

## Bundle id

- Android/iOS: `school.bhbinternational.cbse_school_mobile`
