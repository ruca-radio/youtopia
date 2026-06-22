/**
 * BeatDetector smoke test — synthetic click track at known BPMs.
 * Run: npx tsx test_beat_detector.ts
 */
import { BeatDetector, generateClickTrack } from "./src/dsp/BeatDetector.js";

const TEST_CASES = [
  { bpm: 60, label: "60 BPM (Adagio)" },
  { bpm: 90, label: "90 BPM (Andante)" },
  { bpm: 120, label: "120 BPM (Allegro)" },
  { bpm: 140, label: "140 BPM (Fast)" },
];

console.log("BeatDetector smoke test — synthetic click tracks\n");
console.log("Target BPM | Detected BPM | Confidence | Pass?");
console.log("-----------|--------------|------------|------");

let allPassed = true;

for (const { bpm, label } of TEST_CASES) {
  const sr = 22050;
  const duration = 8; // 8 seconds of audio
  const clickTrack = generateClickTrack(bpm, duration, sr);
  const telemetry = BeatDetector.analyzeBuffer(clickTrack, sr);

  const detectedBpm = telemetry.bpm;
  const confidence = telemetry.confidence;

  // Accept within 5% of target (also accept half/double for octave errors)
  const pct = Math.abs(detectedBpm - bpm) / bpm;
  const pctHalf = Math.abs(detectedBpm - bpm / 2) / (bpm / 2);
  const pctDouble = Math.abs(detectedBpm - bpm * 2) / (bpm * 2);
  const pass = pct < 0.05 || pctHalf < 0.05 || pctDouble < 0.05;

  if (!pass) allPassed = false;

  const status = pass ? "PASS ✓" : "FAIL ✗";
  console.log(
    `${String(bpm).padStart(10)} | ${String(detectedBpm.toFixed(1)).padStart(12)} | ${String(confidence.toFixed(3)).padStart(10)} | ${status}  (${label})`
  );
}

console.log("\n" + (allPassed ? "All tests passed." : "Some tests failed."));
process.exit(allPassed ? 0 : 1);
