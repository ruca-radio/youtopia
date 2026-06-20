#!/usr/bin/env node
import { readFileSync } from "node:fs";

const checks = [
  {
    file: "firetv-receiver/src/main/AndroidManifest.xml",
    patterns: [
      /package="studio\.youtopia\.tvreceiver"/,
      /android\.permission\.INTERNET/,
      /android\.intent\.category\.LEANBACK_LAUNCHER/,
      /android:screenOrientation="landscape"/,
      /android:exported="true"/,
    ],
  },
  {
    file: "firetv-receiver/src/main/java/studio/youtopia/tvreceiver/MainActivity.java",
    patterns: [
      /http:\/\/10\.27\.27\.96:9863\/tv\/program-receiver/,
      /\/tv\/program-receiver/,
      /FLAG_KEEP_SCREEN_ON/,
      /setMediaPlaybackRequiresUserGesture\(false\)/,
      /dispatchKeyEvent/,
      /KEYCODE_MEDIA_PLAY_PAUSE/,
      /KEYCODE_DPAD_CENTER/,
      /KEYCODE_MEDIA_FAST_FORWARD/,
      /KEYCODE_MEDIA_REWIND/,
      /\/tv\/control/,
      /window\.youtopiaTvControl/,
      /evaluateJavascript/,
      /onStop/,
      /disconnectTvAudio/,
      /loadUrl\(TV_URL\)/,
      /playPause/,
      /previous/,
      /next/,
      /reload/,
    ],
  },
  {
    file: "scripts/build-firetv-receiver.sh",
    patterns: [
      /android-23\/android\.jar/,
      /build-tools\/debian\/dx/,
      /APKSIGNER=.*apksigner/,
      /\$APKSIGNER" sign/,
      /zipalign/,
      /youtopia-tv-receiver\.apk/,
    ],
  },
];

let failures = 0;

for (const check of checks) {
  const contents = readFileSync(check.file, "utf8");
  for (const pattern of check.patterns) {
    if (!pattern.test(contents)) {
      failures += 1;
      console.error(`${check.file} is missing ${pattern}`);
    }
  }
}

if (failures > 0) {
  process.exit(1);
}

console.log("Fire TV receiver structure verified");
