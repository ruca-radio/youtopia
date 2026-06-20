#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

echo "============================================="
echo "Building Youtopia desktop package..."
echo "============================================="
yarn make --targets @electron-forge/maker-deb

echo "============================================="
echo "Installing desktop package (requires sudo)..."
echo "============================================="
sudo dpkg -i out/make/deb/x64/youtopia_2.0.11_amd64.deb

echo "============================================="
echo "Building Fire TV receiver APK..."
echo "============================================="
bash scripts/build-firetv-receiver.sh

echo "============================================="
echo "Installing Fire TV receiver APK via ADB..."
echo "============================================="
adb install -r firetv-receiver/build/youtopia-tv-receiver.apk

echo "============================================="
echo "Rebuild and installation complete!"
echo "============================================="
