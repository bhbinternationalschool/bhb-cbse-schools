#!/usr/bin/env bash
# Build one of the two apps and prove the artefact matches its audience.
#
#   scripts/build.sh parent appbundle   # Play upload
#   scripts/build.sh parent apk         # sideload / permission check
#   scripts/build.sh staff  apk         # the download-page APK
#
# The flavour and the Dart entry point MUST travel together: the flavour
# decides the manifest (permissions, applicationId) and the entry point
# decides the code. Passing them separately to `flutter build` lets them
# drift, producing an app whose manifest and code disagree. This script
# pairs them and then reads the permissions back out of the built file, so
# a new plugin quietly re-introducing background location on the parent
# app fails the build instead of failing Play review.
set -euo pipefail

FLAVOR="${1:-}"
KIND="${2:-appbundle}"
case "$FLAVOR" in
  parent|staff) ;;
  *) echo "usage: $0 parent|staff [apk|appbundle]" >&2; exit 2 ;;
esac
case "$KIND" in
  apk|appbundle) ;;
  *) echo "usage: $0 parent|staff [apk|appbundle]" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."

# Release signing is gitignored; without it Gradle silently debug-signs and
# the result neither installs over the published app nor uploads to Play.
if [ ! -f android/key.properties ] || [ ! -f android/app/upload-keystore.jks ]; then
  echo "android/key.properties or android/app/upload-keystore.jks missing —" >&2
  echo "copy both from the main checkout; a release build without them is debug-signed." >&2
  exit 1
fi

case "$FLAVOR" in
  parent) EXPECT_PKG="school.bhbinternational.parent" ;;
  staff)  EXPECT_PKG="school.bhbinternational.cbse_school_mobile" ;;
esac

# Remove last time's artefact first so that its presence afterwards proves
# this run produced it (an up-to-date Gradle task would otherwise leave a
# stale file in place and look like success).
AAB="build/app/outputs/bundle/${FLAVOR}Release/app-$FLAVOR-release.aab"
[ "$KIND" = appbundle ] && rm -f "$AAB"
# Google Play requires ITS billing for digital content consumed in an app it
# distributes, so the tutor pass is bought through Play in the appbundle that
# goes to Play. The sideloaded APK keeps the Cashfree checkout — Play's rules
# do not reach an app Play did not deliver — and school FEES stay on Cashfree
# in both, because paying for a real-world education service is exempt.
DEFINES=()
if [ "$FLAVOR" = parent ] && [ "$KIND" = appbundle ]; then
  DEFINES+=(--dart-define=PLAY_BILLING=true)
  echo "Play Billing ON (tutor pass buys through Google Play in this build)"
fi

# Staff sign-in is Supabase email + password, so the staff build MUST carry
# the project URL and its anon (publishable) key. Without them the login
# screen answers "Staff login is not configured in this build (missing
# Supabase keys)" — which is exactly what Google's reviewer saw and why Play
# rejected BHB Staff 1.0.16 on 8 Oct 2026 ("login credentials are
# incorrect"). Taken from the environment, else from the web app's
# .env.local (NEXT_PUBLIC_* — public by design, they ship to every browser).
if [ "$FLAVOR" = staff ]; then
  ENV_LOCAL="../apps/web/.env.local"
  if [ -z "${SUPABASE_URL:-}" ] && [ -f "$ENV_LOCAL" ]; then
    SUPABASE_URL=$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_LOCAL" | head -1 | cut -d= -f2- | tr -d '"' || true)
  fi
  if [ -z "${SUPABASE_ANON_KEY:-}" ] && [ -f "$ENV_LOCAL" ]; then
    SUPABASE_ANON_KEY=$(grep -E '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' "$ENV_LOCAL" | head -1 | cut -d= -f2- | tr -d '"' || true)
  fi
  if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
    echo "FAIL: staff build needs SUPABASE_URL and SUPABASE_ANON_KEY (env, or NEXT_PUBLIC_* in $ENV_LOCAL)." >&2
    echo "      Without them staff email sign-in is dead in the built app." >&2
    exit 1
  fi
  DEFINES+=(--dart-define=SUPABASE_URL="$SUPABASE_URL" --dart-define=SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY")
  echo "Supabase sign-in keys: included (${SUPABASE_URL})"
fi

if ! flutter build "$KIND" --release --flavor "$FLAVOR" -t "lib/main_$FLAVOR.dart" "${DEFINES[@]+"${DEFINES[@]}"}"; then
  # Known false negative on this Mac: after a successful bundle, flutter runs
  # apkanalyzer (from cmdline-tools, not installed here) to confirm the debug
  # symbols were stripped, cannot find it, and exits 1 with "failed to strip
  # debug symbols". Do the same check ourselves: a bundle this run wrote that
  # carries libapp.so.sym and libflutter.so.sym is stripped and fine.
  # (Listing captured once: with pipefail, `unzip | grep -q` fails on the
  # SIGPIPE grep causes by exiting early, even when it matched.)
  LISTING=""
  [ "$KIND" = appbundle ] && [ -f "$AAB" ] && LISTING=$(unzip -l "$AAB")
  if grep -q 'libapp\.so\.sym' <<<"$LISTING" && grep -q 'libflutter\.so\.sym' <<<"$LISTING"; then
    echo "note: flutter's apkanalyzer symbol check is unavailable here; the bundle has its .sym files, continuing"
  else
    echo "FAIL: flutter build failed" >&2
    exit 1
  fi
fi

# ---- read the manifest back out of what was built ---------------------------
if [ "$KIND" = apk ]; then
  OUT="build/app/outputs/flutter-apk/app-$FLAVOR-release.apk"
  SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
  AAPT2=$(ls "$SDK"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1 || true)
  [ -n "$AAPT2" ] || { echo "aapt2 not found under $SDK/build-tools; cannot verify" >&2; exit 1; }
  MANIFEST=$("$AAPT2" dump permissions "$OUT")
  PKG=$(echo "$MANIFEST" | sed -n 's/^package: //p')
  PERMS=$(echo "$MANIFEST" | sed -n "s/^uses-permission: name='\(.*\)'/\1/p")
else
  OUT="build/app/outputs/bundle/${FLAVOR}Release/app-$FLAVOR-release.aab"
  # No bundletool on this Mac. The bundle's manifest is protobuf, but its
  # string literals are plain UTF-8, so grepping is enough for a gate. It is
  # slightly over-inclusive (it also sees permissions named on components),
  # which errs on the side of failing — build the apk variant to see exactly.
  # Read the manifest straight from the archive each time. Holding it in a
  # shell variable looked simpler and was wrong: this is protobuf, command
  # substitution truncates at the first NUL, and the gate then reports a
  # DIFFERENT permission list depending on where the bytes fall. A safety
  # check that is not deterministic is not a safety check.
  MF() { unzip -p "$OUT" base/manifest/AndroidManifest.xml; }
  PKG=$(MF | grep -a -o -E 'school\.bhbinternational\.[a-z_]+' | head -1)
  # Every permission namespace, not just android.permission.*: in_app_purchase
  # adds `com.android.vending.BILLING` and Firebase adds two under
  # com.google.android.c2dm, none of which a pattern anchored on
  # `android.permission.` can see. A gate blind to a namespace is not a gate.
  PERMS=$( { MF | grep -a -o -E '[a-z][a-z0-9_.]*\.permission\.[A-Z_]+';
             MF | grep -a -o -E 'com\.android\.vending\.[A-Z_]+'; } | sort -u)
fi

echo
echo "built:   $OUT ($(du -h "$OUT" | cut -f1))"
echo "package: $PKG"
echo "permissions:"
echo "$PERMS" | sed 's/^/  /'

if [ "$PKG" != "$EXPECT_PKG" ]; then
  echo "FAIL: expected package $EXPECT_PKG" >&2
  exit 1
fi

if [ "$FLAVOR" = parent ]; then
  # Anything here needs a Play declaration form the parent app must never file.
  # RECORD_AUDIO is deliberately NOT in this list: the AI tutor's voice input
  # needs the microphone (runtime prompt only, no declaration form), and
  # recognition runs through the phone's own speech service.
  # Foreground location is allowed (the pickup-point pin); background is not.
  BAD=$(echo "$PERMS" | grep -E 'BACKGROUND_LOCATION|FOREGROUND_SERVICE|CAMERA|READ_MEDIA|READ_EXTERNAL_STORAGE|RECEIVE_BOOT_COMPLETED' || true)
  if [ -n "$BAD" ]; then
    echo "FAIL: the parent app must not carry these — a plugin's manifest is" >&2
    echo "merging them in; add tools:node=\"remove\" lines to" >&2
    echo "android/app/src/parent/AndroidManifest.xml:" >&2
    echo "$BAD" | sed 's/^/  /' >&2
    exit 1
  fi
  echo "$PERMS" | grep -q RECORD_AUDIO || { echo "FAIL: parent app lost RECORD_AUDIO; the tutor's voice input will not work" >&2; exit 1; }
  echo "OK: parent app carries no restricted permission (microphone kept for tutor voice input)"
else
  # Since 1.0.16 the staff app uses location only in the foreground (punch,
  # survey day). Background location is a Play-restricted permission that
  # blocks review; it must not come back through a plugin's manifest.
  BAD=$(echo "$PERMS" | grep -E 'ACCESS_BACKGROUND_LOCATION|FOREGROUND_SERVICE_LOCATION' || true)
  if [ -n "$BAD" ]; then
    echo "FAIL: the staff app must not carry background location — add tools:node=\"remove\"" >&2
    echo "lines to android/app/src/staff/AndroidManifest.xml:" >&2
    echo "$BAD" | sed 's/^/  /' >&2
    exit 1
  fi
  echo "$PERMS" | grep -q ACCESS_FINE_LOCATION || { echo "FAIL: staff app lost ACCESS_FINE_LOCATION; the punch fence check will not work" >&2; exit 1; }
  echo "OK: staff app has foreground location only"
  # Read the sign-in keys back out of the compiled code, the same way the
  # permissions are read back: a define that did not land is a dead login.
  if [ "$KIND" = appbundle ]; then
    LIBAPP=$(unzip -p "$OUT" base/lib/arm64-v8a/libapp.so 2>/dev/null | strings | grep -c "$SUPABASE_URL" || true)
  else
    LIBAPP=$(unzip -p "$OUT" lib/arm64-v8a/libapp.so 2>/dev/null | strings | grep -c "$SUPABASE_URL" || true)
  fi
  if [ "${LIBAPP:-0}" -lt 1 ]; then
    echo "FAIL: the built staff app does not contain $SUPABASE_URL — staff sign-in would be dead" >&2
    exit 1
  fi
  echo "OK: staff sign-in keys are compiled in"
fi
