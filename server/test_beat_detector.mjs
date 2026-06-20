/**
 * BeatDetector smoke test — synthetic click track.
 * Run with: node test_beat_detector.mjs
 * (uses .mjs so we can use top-level await without tsconfig)
 */

// Inline the algorithm (copy-paste of the compiled logic) so we can test
// without transpiling. We'll use tsx instead:
// node --experimental-vm-modules ... or just use tsx

// Actually use tsx directly since it's available
// This is just a runner shim — see beat_test.ts
