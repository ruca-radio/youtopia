#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/firetv-receiver"
SRC_DIR="$APP_DIR/src/main"
BUILD_DIR="$APP_DIR/build"
GEN_DIR="$BUILD_DIR/generated"
CLASSES_DIR="$BUILD_DIR/classes"
DEX_DIR="$BUILD_DIR/dex"
UNSIGNED_APK="$BUILD_DIR/youtopia-tv-receiver-unsigned.apk"
ALIGNED_APK="$BUILD_DIR/youtopia-tv-receiver-aligned.apk"
SIGNED_APK="$BUILD_DIR/youtopia-tv-receiver.apk"
KEYSTORE="$APP_DIR/youtopia-tv-debug.keystore"

ANDROID_JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
AAPT="${AAPT:-/usr/lib/android-sdk/build-tools/debian/aapt}"
DX="${DX:-/usr/lib/android-sdk/build-tools/debian/dx}"
ZIPALIGN="${ZIPALIGN:-/usr/bin/zipalign}"
APKSIGNER="${APKSIGNER:-/usr/bin/apksigner}"

if [[ ! -f "$ANDROID_JAR" ]]; then
  echo "Missing Android platform jar: $ANDROID_JAR" >&2
  exit 1
fi

rm -rf "$BUILD_DIR"
mkdir -p "$GEN_DIR" "$CLASSES_DIR" "$DEX_DIR"

"$AAPT" package \
  -f \
  -m \
  -J "$GEN_DIR" \
  -M "$SRC_DIR/AndroidManifest.xml" \
  -S "$SRC_DIR/res" \
  -I "$ANDROID_JAR"

mapfile -t JAVA_FILES < <(find "$SRC_DIR/java" "$GEN_DIR" -name "*.java" | sort)

javac \
  -source 8 \
  -target 8 \
  -bootclasspath "$ANDROID_JAR" \
  -classpath "$GEN_DIR" \
  -d "$CLASSES_DIR" \
  "${JAVA_FILES[@]}"

"$DX" \
  --dex \
  --min-sdk-version=23 \
  --output="$DEX_DIR/classes.dex" \
  "$CLASSES_DIR"

"$AAPT" package \
  -f \
  -M "$SRC_DIR/AndroidManifest.xml" \
  -S "$SRC_DIR/res" \
  -I "$ANDROID_JAR" \
  -F "$UNSIGNED_APK" \
  "$DEX_DIR"

"$ZIPALIGN" -f 4 "$UNSIGNED_APK" "$ALIGNED_APK"

if [[ ! -f "$KEYSTORE" ]]; then
  keytool \
    -genkeypair \
    -keystore "$KEYSTORE" \
    -storepass android \
    -keypass android \
    -alias youtopia-tv \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=Youtopia TV,O=Youtopia,C=US" \
    >/dev/null
fi

"$APKSIGNER" sign \
  --ks "$KEYSTORE" \
  --ks-pass pass:android \
  --key-pass pass:android \
  --out "$SIGNED_APK" \
  "$ALIGNED_APK"

"$APKSIGNER" verify --verbose "$SIGNED_APK"

echo "$SIGNED_APK"
