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
if ! flutter build "$KIND" --release --flavor "$FLAVOR" -t "lib/main_$FLAVOR.dart"; then
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
  RAW=$(unzip -p "$OUT" base/manifest/AndroidManifest.xml)
  PKG=$(echo "$RAW" | grep -a -o -E 'school\.bhbinternational\.[a-z_]+' | head -1)
  PERMS=$(echo "$RAW" | grep -a -o -E 'android\.permission\.[A-Z_]+' | sort -u)
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
  BAD=$(echo "$PERMS" | grep -E 'LOCATION|RECORD_AUDIO|CAMERA|FOREGROUND_SERVICE|READ_MEDIA|READ_EXTERNAL_STORAGE|RECEIVE_BOOT_COMPLETED' || true)
  if [ -n "$BAD" ]; then
    echo "FAIL: the parent app must not carry these — a plugin's manifest is" >&2
    echo "merging them in; add tools:node=\"remove\" lines to" >&2
    echo "android/app/src/parent/AndroidManifest.xml:" >&2
    echo "$BAD" | sed 's/^/  /' >&2
    exit 1
  fi
  echo "OK: parent app carries no restricted permission"
else
  echo "$PERMS" | grep -q ACCESS_BACKGROUND_LOCATION \
    || { echo "FAIL: staff app lost ACCESS_BACKGROUND_LOCATION; presence pings will not work" >&2; exit 1; }
  echo "OK: staff app keeps background location"
fi
