#!/usr/bin/env bash
# Installs the built APK on the USB-attached phone and opens it.
# The phone must have USB debugging on and the RSA prompt allowed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ADB="${ANDROID_HOME:-${SDK:-$HOME/.local/android/sdk}}/platform-tools/adb"
APK="$HERE/trading-suite.apk"

[ -x "$ADB" ] || { echo "no adb at $ADB — run build.sh once the SDK is installed" >&2; exit 1; }
[ -f "$APK" ] || { echo "no APK at $APK — run build.sh first" >&2; exit 1; }

"$ADB" start-server >/dev/null
"$ADB" devices
"$ADB" wait-for-device
"$ADB" install -r "$APK"
"$ADB" shell monkey -p id.tradingsuite.app -c android.intent.category.LAUNCHER 1 >/dev/null
echo "opened on device"
