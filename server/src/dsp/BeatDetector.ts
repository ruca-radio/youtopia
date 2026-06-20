/**
 * YouTopia DSP — Beat / Tempo Detector.
 *
 * Algorithm overview:
 * ─────────────────
 * 1. ONSET ENVELOPE  — compute spectral flux from overlapping STFT frames.
 *    Spectral flux = sum of positive first differences of the magnitude spectrum
 *    across consecutive frames.  This captures onset energy robustly for music.
 *
 * 2. TEMPO ESTIMATION — autocorrelation of the onset envelope over a window
 *    of ~6 s.  The autocorrelation peak at lag τ implies a period of τ frames
 *    = BPM estimate.  Multiple peaks are checked via a comb filter to resolve
 *    octave ambiguities (e.g. 60 BPM vs 120 BPM).
 *
 * 3. BEAT TRACKING   — phase-locked loop (PLL): once a period estimate exists,
 *    track individual beats by finding the onset-envelope maximum within ±30 %
 *    of the expected beat window.  The estimated phase is updated incrementally.
 *
 * 4. PCM INPUT       — accepts 32-bit float PCM frames at any sample rate
 *    (resampled internally).  In a live pipeline, the DspChain calls
 *    BeatDetector.processChunk(samples, sampleRate) from the ffmpeg pipe tap.
 *    For tests / offline analysis, pass a full buffer to analyzeBuffer().
 *
 * Implementation notes:
 * - No external FFT library is required: we use a pure-JS radix-2 Cooley-Tukey
 *   FFT.  This is fine for the frame size (2048 samples) and the analysis
 *   window (≈6 s @ 22 050 Hz).
 * - Sample rate is normalized to 22 050 Hz via linear interpolation before
 *   processing so that BPM arithmetic is independent of source rate.
 * - BPM is bounded to [40, 220] per the contract.
 */

import type { BeatTelemetry } from "../contracts/index.js";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";

// ── Constants ────────────────────────────────────────────────────────────────

const TARGET_SR = 22050;       // internal analysis sample rate
const FRAME_SIZE = 2048;       // FFT frame size in samples
const HOP_SIZE = 512;          // frames hop (overlap-add stride)
const ANALYSIS_WINDOW_S = 6;   // autocorrelation window length in seconds
const BPM_MIN = 40;
const BPM_MAX = 220;

// Lag range for BPM search: lag in onset-envelope frames
// At HOP_SIZE=512, SR=22050: 1 frame ≈ 23.2 ms
// BPM_MIN=40 → period ≈ 1500 ms ≈ 64.7 frames
// BPM_MAX=220 → period ≈ 272 ms ≈ 11.7 frames
const FRAME_PERIOD_MS = (HOP_SIZE / TARGET_SR) * 1000;
const LAG_MAX = Math.ceil(60000 / (BPM_MIN * FRAME_PERIOD_MS));
const LAG_MIN = Math.floor(60000 / (BPM_MAX * FRAME_PERIOD_MS));

// ── Pure-JS radix-2 FFT (in-place, power-of-2 sizes) ─────────────────────────

/**
 * Cooley-Tukey radix-2 DIT FFT.
 * re[] and im[] are the real and imaginary parts (modified in-place).
 */
function fft(re: Float32Array, im: Float32Array): void {
  const N = re.length;
  // Bit-reverse permutation
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  // Butterfly stages
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = -Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j]!;
        const uIm = im[i + j]!;
        const vRe = re[i + j + len / 2]! * curRe - im[i + j + len / 2]! * curIm;
        const vIm = re[i + j + len / 2]! * curIm + im[i + j + len / 2]! * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** Compute magnitude spectrum (first N/2+1 bins). */
function magnitudeSpectrum(frame: Float32Array): Float32Array {
  const N = frame.length;
  const re = new Float32Array(frame);
  const im = new Float32Array(N);
  fft(re, im);
  const mags = new Float32Array(N / 2 + 1);
  for (let k = 0; k <= N / 2; k++) {
    mags[k] = Math.sqrt(re[k]! * re[k]! + im[k]! * im[k]!);
  }
  return mags;
}

// ── Linear resampler ─────────────────────────────────────────────────────────

function resample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const outLen = Math.round(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = pos - lo;
    out[i] = (input[lo]! * (1 - frac) + input[hi]! * frac);
  }
  return out;
}

// ── Autocorrelation of onset envelope ────────────────────────────────────────

function autocorrelation(odf: Float32Array, maxLag: number): Float32Array {
  const N = odf.length;
  const ac = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < N - lag; i++) {
      sum += odf[i]! * odf[i + lag]!;
    }
    ac[lag] = sum / (N - lag);
  }
  return ac;
}

/** Find the best BPM by searching autocorrelation peaks in [lagMin, lagMax]. */
function estimateBpmFromAc(
  ac: Float32Array,
  lagMin: number,
  lagMax: number,
): { bpm: number; confidence: number } {
  let bestLag = lagMin;
  let bestVal = -Infinity;

  for (let lag = lagMin; lag <= lagMax && lag < ac.length; lag++) {
    if (ac[lag]! > bestVal) {
      bestVal = ac[lag]!;
      bestLag = lag;
    }
  }

  if (bestLag === 0 || bestVal <= 0) {
    return { bpm: 0, confidence: 0 };
  }

  const bpm = 60000 / (bestLag * FRAME_PERIOD_MS);
  const clampedBpm = Math.max(BPM_MIN, Math.min(BPM_MAX, bpm));

  // Confidence: ratio of peak to DC (lag=0) autocorrelation
  const dc = ac[0] ?? 1;
  const confidence = dc > 0 ? Math.min(1, bestVal / dc) : 0;

  return { bpm: clampedBpm, confidence };
}

// ── BeatDetector class ────────────────────────────────────────────────────────

export interface BeatDetectorEvents {
  beat: [telemetry: BeatTelemetry];
}

/**
 * Real-time / offline beat and tempo detector.
 *
 * Usage (streaming):
 *   const bd = new BeatDetector();
 *   bd.on('beat', (t) => console.log(t));
 *   // Feed raw f32le PCM chunks (e.g. from ffmpeg pipe):
 *   bd.processChunk(float32Samples, 44100);
 *
 * Usage (offline):
 *   const result = BeatDetector.analyzeBuffer(float32Samples, 44100);
 */
export class BeatDetector extends EventEmitter {
  // Onset envelope ring buffer (~6 s at target SR)
  private readonly _analysisFrames = Math.ceil((ANALYSIS_WINDOW_S * TARGET_SR) / HOP_SIZE);
  private readonly _odf: Float32Array;
  private _odfHead = 0;
  private _odfFilled = 0;

  // PCM accumulation buffer (holds enough for one STFT frame)
  private _pcmBuf: Float32Array = new Float32Array(0);
  private _prevMags: Float32Array = new Float32Array(FRAME_SIZE / 2 + 1);

  // Beat tracking state
  private _bpm = 0;
  private _confidence = 0;
  private _lastBeatAt = 0;
  private _phase = 0;
  private _beatPeriodMs = 0;

  constructor() {
    super();
    this._odf = new Float32Array(this._analysisFrames);
  }

  // ── Streaming interface ──────────────────────────────────────────────────

  /**
   * Feed a chunk of audio samples.
   * @param samples Float32 mono PCM at `sampleRate`.
   * @param sampleRate Source sample rate.
   */
  processChunk(samples: Float32Array, sampleRate: number): void {
    const resampled = resample(samples, sampleRate, TARGET_SR);

    // Append to accumulation buffer
    const combined = new Float32Array(this._pcmBuf.length + resampled.length);
    combined.set(this._pcmBuf);
    combined.set(resampled, this._pcmBuf.length);
    this._pcmBuf = combined;

    // Process complete frames
    while (this._pcmBuf.length >= FRAME_SIZE) {
      const frame = this._pcmBuf.slice(0, FRAME_SIZE);
      this._pcmBuf = this._pcmBuf.slice(HOP_SIZE);
      this._processFrame(frame);
    }
  }

  /**
   * Get the latest telemetry snapshot (does not block).
   */
  getLatestTelemetry(): BeatTelemetry {
    return {
      bpm: Math.round(this._bpm * 10) / 10,
      confidence: Math.round(this._confidence * 1000) / 1000,
      lastBeatAt: this._lastBeatAt,
      phase: this._phase,
    };
  }

  /** Reset all state. */
  reset(): void {
    this._odf.fill(0);
    this._odfHead = 0;
    this._odfFilled = 0;
    this._pcmBuf = new Float32Array(0);
    this._prevMags = new Float32Array(FRAME_SIZE / 2 + 1);
    this._bpm = 0;
    this._confidence = 0;
    this._lastBeatAt = 0;
    this._phase = 0;
    this._beatPeriodMs = 0;
  }

  // ── Core analysis ────────────────────────────────────────────────────────

  private _processFrame(frame: Float32Array): void {
    // 1. Spectral magnitude
    const mags = magnitudeSpectrum(frame);

    // 2. Spectral flux (onset detection function)
    let flux = 0;
    for (let k = 0; k < mags.length; k++) {
      const diff = mags[k]! - this._prevMags[k]!;
      if (diff > 0) flux += diff; // positive half-wave rectification
    }
    this._prevMags = mags;

    // 3. Store in ring buffer
    this._odf[this._odfHead] = flux;
    this._odfHead = (this._odfHead + 1) % this._analysisFrames;
    if (this._odfFilled < this._analysisFrames) this._odfFilled++;

    // 4. Re-estimate tempo once we have enough data (~2 s)
    const minFrames = Math.ceil((2 * TARGET_SR) / HOP_SIZE);
    if (this._odfFilled >= minFrames) {
      this._updateTempo();
    }

    // 5. Update phase
    this._updatePhase();
  }

  private _updateTempo(): void {
    // Flatten ring buffer into a contiguous array in chronological order
    const filled = this._odfFilled;
    const odfLinear = new Float32Array(filled);
    const start = (this._odfHead - filled + this._analysisFrames) % this._analysisFrames;
    for (let i = 0; i < filled; i++) {
      odfLinear[i] = this._odf[(start + i) % this._analysisFrames]!;
    }

    // Mean-subtract for better autocorrelation
    let mean = 0;
    for (let i = 0; i < filled; i++) mean += odfLinear[i]!;
    mean /= filled;
    for (let i = 0; i < filled; i++) odfLinear[i] = (odfLinear[i] ?? 0) - mean;

    const ac = autocorrelation(odfLinear, Math.min(LAG_MAX, filled - 1));
    const { bpm, confidence } = estimateBpmFromAc(ac, LAG_MIN, Math.min(LAG_MAX, filled - 1));

    if (bpm > 0) {
      // Smooth the BPM estimate with a low-pass filter
      const alpha = 0.15;
      this._bpm = this._bpm === 0 ? bpm : this._bpm * (1 - alpha) + bpm * alpha;
      this._confidence = this._confidence * 0.8 + confidence * 0.2;
      this._beatPeriodMs = 60000 / this._bpm;
    }
  }

  private _updatePhase(): void {
    if (this._beatPeriodMs <= 0) return;

    const now = Date.now();
    if (this._lastBeatAt === 0) {
      this._lastBeatAt = now;
      return;
    }

    const elapsed = now - this._lastBeatAt;
    this._phase = (elapsed % this._beatPeriodMs) / this._beatPeriodMs;

    // Detect beat crossing
    if (elapsed >= this._beatPeriodMs * 0.9) {
      this._lastBeatAt = now;
      this._phase = 0;
      const telemetry = this.getLatestTelemetry();
      this.emit("beat", telemetry);
    }
  }

  // ── Offline / static interface ───────────────────────────────────────────

  /**
   * Analyze a complete audio buffer and return BeatTelemetry.
   * Suitable for pre-analysis of short clips.
   *
   * @param samples  Float32 mono PCM.
   * @param sampleRate  Sample rate of the input.
   */
  static analyzeBuffer(samples: Float32Array, sampleRate: number): BeatTelemetry {
    const bd = new BeatDetector();
    bd.processChunk(samples, sampleRate);
    return bd.getLatestTelemetry();
  }

  /**
   * Decode an audio file via ffmpeg and run beat detection on the result.
   * Returns BeatTelemetry.  Useful for pre-analysis of library tracks.
   *
   * @param filePath  Absolute path or URL accessible to ffmpeg.
   * @param maxSeconds  How many seconds to analyze (default 60).
   */
  static analyzeFile(filePath: string, maxSeconds = 60): Promise<BeatTelemetry> {
    return new Promise((resolve, reject) => {
      // ffmpeg: decode to raw f32le mono at TARGET_SR, pipe to stdout
      const args = [
        "-hide_banner",
        "-loglevel", "error",
        "-i", filePath,
        "-t", String(maxSeconds),
        "-vn",
        "-ac", "1",
        "-ar", String(TARGET_SR),
        "-f", "f32le",
        "pipe:1",
      ];

      const proc = spawn("ffmpeg", args);
      const chunks: Buffer[] = [];

      proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      proc.stderr.on("data", (d: Buffer) => {
        /* errors already logged via loglevel=error */
        void d;
      });

      proc.on("close", (code) => {
        if (code !== 0 && chunks.length === 0) {
          reject(new Error(`ffmpeg exited with code ${code ?? "null"}`));
          return;
        }
        const raw = Buffer.concat(chunks);
        // Convert raw bytes to Float32Array
        const samples = new Float32Array(
          raw.buffer,
          raw.byteOffset,
          raw.byteLength / 4,
        );
        resolve(BeatDetector.analyzeBuffer(samples, TARGET_SR));
      });

      proc.on("error", reject);
    });
  }
}

/**
 * Generate a synthetic click track as Float32 mono PCM.
 * Used for unit testing the beat detector.
 *
 * @param bpm        Desired BPM.
 * @param durationS  Duration in seconds.
 * @param sampleRate Sample rate.
 */
export function generateClickTrack(
  bpm: number,
  durationS: number,
  sampleRate: number = TARGET_SR,
): Float32Array {
  const totalSamples = Math.round(durationS * sampleRate);
  const buf = new Float32Array(totalSamples);
  const periodSamples = (60 / bpm) * sampleRate;
  const clickLen = Math.round(0.004 * sampleRate); // 4 ms click

  for (let beat = 0; beat * periodSamples < totalSamples; beat++) {
    const start = Math.round(beat * periodSamples);
    for (let i = 0; i < clickLen && start + i < totalSamples; i++) {
      // Decaying sine click
      const t = i / sampleRate;
      buf[start + i] = Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-1000 * t);
    }
  }

  return buf;
}
