#!/usr/bin/env bash
# Builds trading-suite.apk without Gradle: aapt2 → javac → d8 → zipalign → apksigner.
#
#   SDK=$HOME/.local/android/sdk ./android/build.sh
#
# Needs build-tools, platforms/android-36 and a JDK on PATH (or JAVA_HOME).
# The app is a WebView shell for the scanner: it loads the laptop's LAN address
# and asks for a new one if that address stops answering.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-${SDK:-$HOME/.local/android/sdk}}"
[ -x "${JAVA_HOME:-}/bin/javac" ] && export PATH="$JAVA_HOME/bin:$PATH"

BUILD_TOOLS="$(find "$SDK/build-tools" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1)"
PLATFORM="$SDK/platforms/android-36/android.jar"
[ -x "$BUILD_TOOLS/aapt2" ] || { echo "no build-tools under $SDK" >&2; exit 1; }
[ -f "$PLATFORM" ] || { echo "no android.jar: expected $PLATFORM" >&2; exit 1; }

OUT="$HERE/build"
MIN_SDK=24
TARGET_SDK=36
rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/dex"

DIST="$HERE/../frontend-native"
[ -d "$DIST" ] || { echo "no frontend directory: expected frontend-native/" >&2; exit 1; }
# aapt2 -A packs the directory's *contents* as assets/, so mirror dist/ under web/.
ASSETS="$OUT/assets"
rm -rf "$ASSETS"
mkdir -p "$ASSETS/web"
cp -r "$DIST/." "$ASSETS/web/"

echo "→ resources"
"$BUILD_TOOLS/aapt2" compile --dir "$HERE/app/src/main/res" -o "$OUT/res.zip"
"$BUILD_TOOLS/aapt2" link \
    -o "$OUT/app-unsigned.apk" \
    -I "$PLATFORM" \
    --manifest "$HERE/app/src/main/AndroidManifest.xml" \
    -A "$ASSETS" \
    --min-sdk-version "$MIN_SDK" \
    --target-sdk-version "$TARGET_SDK" \
    --version-code 1 \
    --version-name 0.1.0 \
    "$OUT/res.zip"

echo "→ compile"
find "$HERE/app/src/main/java" -name '*.java' > "$OUT/sources.txt"
javac --release 17 -classpath "$PLATFORM" -d "$OUT/classes" @"$OUT/sources.txt"

echo "→ dex"
find "$OUT/classes" -name '*.class' > "$OUT/classes.txt"
"$BUILD_TOOLS/d8" --lib "$PLATFORM" --min-api "$MIN_SDK" --output "$OUT/dex" @"$OUT/classes.txt"
(cd "$OUT/dex" && zip -q -j "$OUT/app-unsigned.apk" classes.dex)

echo "→ align + sign"
"$BUILD_TOOLS/zipalign" -f 4 "$OUT/app-unsigned.apk" "$OUT/app-aligned.apk"
if [ ! -f "$HERE/debug.keystore" ]; then
    keytool -genkeypair \
        -keystore "$HERE/debug.keystore" \
        -storepass android -keypass android \
        -alias androiddebugkey \
        -dname "CN=Android Debug,O=Android,C=US" \
        -keyalg RSA -keysize 2048 -validity 10000
fi
"$BUILD_TOOLS/apksigner" sign \
    --ks "$HERE/debug.keystore" \
    --ks-key-alias androiddebugkey \
    --ks-pass pass:android --key-pass pass:android \
    --out "$HERE/trading-suite.apk" \
    "$OUT/app-aligned.apk"

echo "built $HERE/trading-suite.apk"
"$BUILD_TOOLS/apksigner" verify --print-certs "$HERE/trading-suite.apk" | head -3
