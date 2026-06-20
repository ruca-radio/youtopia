import { ChildProcessWithoutNullStreams, spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export type TvAudioStream = {
  source: string;
  contentType: string;
  process: ChildProcessWithoutNullStreams;
  stop: () => void;
};

export type TvProgramStream = TvAudioStream;

export type TvProgramHlsStream = {
  source: string;
  directory: string;
  playlistPath: string;
  process: ChildProcessWithoutNullStreams;
  stop: () => void;
};

export type TvProgramMetadata = {
  artist: string;
  title: string;
};

export type TvAudioStatus = {
  available: boolean;
  contentTypes: Record<TvAudioFormat, string>;
  ffmpegAvailable: boolean;
  source: string;
};

export type TvAudioFormat = "mp3" | "webm";

const TV_AUDIO_CONTENT_TYPES: Record<TvAudioFormat, string> = {
  mp3: "audio/mpeg",
  webm: "audio/webm"
};

const TV_PROGRAM_CONTENT_TYPE = "video/mp4";
const TV_PROGRAM_HLS_DIR = path.join(os.tmpdir(), "youtopia-tv-program-hls");
const PIPEWIRE_NODE_NAME_KEY = "node.name";
let activeTvProgramHlsStream: { signature: string; stream: TvProgramHlsStream } | null = null;

export function getTvAudioStatus(): TvAudioStatus {
  const ffmpegAvailable = commandAvailable("ffmpeg");
  const source = resolvePulseMonitorSource();

  return {
    available: ffmpegAvailable && source.length > 0,
    contentTypes: TV_AUDIO_CONTENT_TYPES,
    ffmpegAvailable,
    source
  };
}

export function createTvAudioStream(format: TvAudioFormat = "mp3"): TvAudioStream {
  const source = resolvePulseMonitorSource();
  const audioFormat = format === "webm" ? "webm" : "mp3";
  const ffmpeg = spawn("ffmpeg", getTvAudioFfmpegArgs(source, audioFormat), {
    stdio: ["ignore", "pipe", "pipe"]
  });

  return {
    source,
    contentType: TV_AUDIO_CONTENT_TYPES[audioFormat],
    process: ffmpeg,
    stop: () => {
      if (ffmpeg.killed || ffmpeg.exitCode !== null) return;
      ffmpeg.kill("SIGTERM");
      setTimeout(() => {
        if (!ffmpeg.killed && ffmpeg.exitCode === null) {
          ffmpeg.kill("SIGKILL");
        }
      }, 1000).unref();
    }
  };
}

export function createTvProgramStream(metadata: TvProgramMetadata): TvProgramStream {
  const source = resolvePulseMonitorSource();
  const ffmpeg = spawn("ffmpeg", getTvProgramFfmpegArgs(source, metadata), {
    stdio: ["ignore", "pipe", "pipe"]
  });

  return {
    source,
    contentType: TV_PROGRAM_CONTENT_TYPE,
    process: ffmpeg,
    stop: () => {
      if (ffmpeg.killed || ffmpeg.exitCode !== null) return;
      ffmpeg.kill("SIGTERM");
      setTimeout(() => {
        if (!ffmpeg.killed && ffmpeg.exitCode === null) {
          ffmpeg.kill("SIGKILL");
        }
      }, 1000).unref();
    }
  };
}

export function ensureTvProgramHlsStream(metadata: TvProgramMetadata): TvProgramHlsStream {
  const source = resolvePulseMonitorSource();
  const signature = source;
  if (activeTvProgramHlsStream && activeTvProgramHlsStream.signature === signature && activeTvProgramHlsStream.stream.process.exitCode === null) {
    return activeTvProgramHlsStream.stream;
  }

  if (activeTvProgramHlsStream) {
    activeTvProgramHlsStream.stream.stop();
    activeTvProgramHlsStream = null;
  }

  fs.rmSync(TV_PROGRAM_HLS_DIR, { force: true, recursive: true });
  fs.mkdirSync(TV_PROGRAM_HLS_DIR, { recursive: true });

  const playlistPath = path.join(TV_PROGRAM_HLS_DIR, "live.m3u8");
  const segmentPath = path.join(TV_PROGRAM_HLS_DIR, "segment-%05d.ts");
  const ffmpeg = spawn("ffmpeg", getTvProgramHlsFfmpegArgs(source, metadata, playlistPath, segmentPath), {
    stdio: ["ignore", "ignore", "pipe"]
  });
  const stream = {
    source,
    directory: TV_PROGRAM_HLS_DIR,
    playlistPath,
    process: ffmpeg,
    stop: () => {
      if (ffmpeg.killed || ffmpeg.exitCode !== null) return;
      ffmpeg.kill("SIGTERM");
      setTimeout(() => {
        if (!ffmpeg.killed && ffmpeg.exitCode === null) {
          ffmpeg.kill("SIGKILL");
        }
      }, 1000).unref();
    }
  };

  activeTvProgramHlsStream = { signature, stream };
  return stream;
}

export function getTvProgramHlsFilePath(fileName: string): string | null {
  if (fileName === "live.m3u8") return path.join(TV_PROGRAM_HLS_DIR, fileName);
  if (!/^segment-\d{5}\.ts$/.test(fileName)) return null;
  return path.join(TV_PROGRAM_HLS_DIR, fileName);
}

function getTvProgramFfmpegArgs(source: string, metadata: TvProgramMetadata): string[] {
  const videoEncoder = selectTvProgramVideoEncoder();
  const videoEncoderArgs =
    videoEncoder === "h264_nvenc"
      ? [
          "-codec:v",
          "h264_nvenc",
          "-preset",
          "llhp",
          "-tune",
          "ull",
          "-profile:v",
          "main",
          "-rc",
          "cbr",
          "-b:v",
          "2800k",
          "-maxrate",
          "2800k",
          "-bufsize",
          "1400k"
        ]
      : ["-codec:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-profile:v", "main", "-b:v", "2200k", "-maxrate", "2200k", "-bufsize", "1100k"];

  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-probesize",
    "32",
    "-analyzeduration",
    "0",
    "-fflags",
    "nobuffer",
    "-flags",
    "low_delay",
    "-f",
    "pulse",
    "-sample_rate",
    "48000",
    "-channels",
    "2",
    "-fragment_size",
    "960",
    "-i",
    source,
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=1280x720:r=30",
    "-filter_complex",
    getTvProgramVideoFilter(metadata),
    "-map",
    "[v]",
    "-map",
    "[aout]",
    ...videoEncoderArgs,
    "-r",
    "30",
    "-g",
    "30",
    "-keyint_min",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-codec:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "-f",
    "mp4",
    "-flush_packets",
    "1",
    "pipe:1"
  ];
}

function getTvProgramHlsFfmpegArgs(source: string, metadata: TvProgramMetadata, playlistPath: string, segmentPath: string): string[] {
  const videoEncoder = selectTvProgramVideoEncoder();
  const videoEncoderArgs =
    videoEncoder === "h264_nvenc"
      ? [
          "-codec:v",
          "h264_nvenc",
          "-preset",
          "llhp",
          "-tune",
          "ull",
          "-profile:v",
          "main",
          "-rc",
          "cbr",
          "-b:v",
          "2800k",
          "-maxrate",
          "2800k",
          "-bufsize",
          "1400k"
        ]
      : ["-codec:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-profile:v", "main", "-b:v", "2200k", "-maxrate", "2200k", "-bufsize", "1100k"];

  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-probesize",
    "32",
    "-analyzeduration",
    "0",
    "-fflags",
    "nobuffer",
    "-flags",
    "low_delay",
    "-f",
    "pulse",
    "-sample_rate",
    "48000",
    "-channels",
    "2",
    "-fragment_size",
    "960",
    "-i",
    source,
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=1280x720:r=30",
    "-filter_complex",
    getTvProgramVideoFilter(metadata),
    "-map",
    "[v]",
    "-map",
    "[aout]",
    ...videoEncoderArgs,
    "-r",
    "30",
    "-g",
    "30",
    "-keyint_min",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-codec:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-muxdelay",
    "0",
    "-muxpreload",
    "0",
    "-f",
    "hls",
    "-hls_time",
    "1",
    "-hls_list_size",
    "5",
    "-hls_segment_type",
    "mpegts",
    "-hls_flags",
    "delete_segments+omit_endlist+independent_segments+program_date_time",
    "-hls_base_url",
    "/tv/program-hls/",
    "-hls_segment_filename",
    segmentPath,
    playlistPath
  ];
}

function getTvProgramVideoFilter(metadata: TvProgramMetadata): string {
  const title = escapeDrawText(metadata.title || "Youtopia");
  const artist = escapeDrawText(metadata.artist || "Server program feed");

  return [
    `[0:a]${buildTvProgramAudioFilter()},asplit=2[aout][avis]`,
    "[avis]showwaves=s=1080x220:mode=line:rate=30:colors=0x22d3ee|0xef4444,format=rgba[wave]",
    "[1:v]format=rgba,drawbox=x=0:y=0:w=1280:h=720:color=black@1:t=fill[base0]",
    "[base0]drawbox=x=42:y=34:w=1196:h=150:color=0x0b0f14@1:t=fill,drawbox=x=42:y=34:w=1196:h=150:color=0x22d3ee@0.42:t=3[head]",
    "[head]drawbox=x=58:y=276:w=1164:h=252:color=0x020617@1:t=fill,drawbox=x=58:y=276:w=1164:h=252:color=0x38bdf8@0.42:t=3[vubox]",
    "[vubox]drawbox=x=92:y=398:w=1096:h=2:color=0xe2e8f0@0.55:t=fill,drawbox=x=92:y=350:w=1096:h=1:color=0x334155@0.7:t=fill,drawbox=x=92:y=446:w=1096:h=1:color=0x334155@0.7:t=fill[rails]",
    "[rails][wave]overlay=x=100:y=292:format=auto[composite]",
    "[composite]drawbox=x=92:y=474:w=120:h=34:color=0x22c55e@0.55:t=fill,drawbox=x=226:y=456:w=120:h=52:color=0x84cc16@0.55:t=fill,drawbox=x=360:y=436:w=120:h=72:color=0xfacc15@0.55:t=fill,drawbox=x=494:y=416:w=120:h=92:color=0xfb923c@0.50:t=fill,drawbox=x=628:y=396:w=120:h=112:color=0xef4444@0.45:t=fill[vubars]",
    `[vubars]drawtext=text='${title}':x=66:y=58:fontsize=48:fontcolor=0xf8fafc:box=1:boxcolor=0x020617@0.72:boxborderw=16[title]`,
    `[title]drawtext=text='${artist}':x=70:y=128:fontsize=28:fontcolor=0xcbd5e1:box=1:boxcolor=0x020617@0.55:boxborderw=10[artist]`,
    "[artist]drawtext=text='SERVER HLS':x=1000:y=92:fontsize=30:fontcolor=0x22d3ee:box=1:boxcolor=0x020617@0.78:boxborderw=14[badge]",
    "[badge]drawtext=text='VU ACTIVE':x=92:y=236:fontsize=24:fontcolor=0xa7f3d0:box=1:boxcolor=0x020617@0.72:boxborderw=10,format=yuv420p[v]"
  ].join(";");
}

function buildTvProgramAudioFilter(): string {
  return ["aresample=48000", "volume=8dB", "dynaudnorm=f=250:g=31:p=0.95:m=30:r=0.20:n=1", "alimiter=limit=0.92:attack=5:release=50"].join(",");
}

function selectTvProgramVideoEncoder(): "h264_nvenc" | "libx264" {
  if (ffmpegEncoderAvailable("h264_nvenc")) return "h264_nvenc";
  return "libx264";
}

function getTvAudioFfmpegArgs(source: string, format: TvAudioFormat): string[] {
  const inputArgs = [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-fflags",
    "nobuffer",
    "-flags",
    "low_delay",
    "-f",
    "pulse",
    "-sample_rate",
    "48000",
    "-channels",
    "2",
    "-fragment_size",
    "3840",
    "-i",
    source,
    "-vn",
    "-ac",
    "2"
  ];

  if (format === "webm") {
    return [
      ...inputArgs,
      "-ar",
      "48000",
      "-codec:a",
      "libopus",
      "-b:a",
      "128k",
      "-application",
      "lowdelay",
      "-frame_duration",
      "10",
      "-f",
      "webm",
      "-live",
      "1",
      "-cluster_time_limit",
      "40",
      "-cluster_size_limit",
      "4096",
      "-flush_packets",
      "1",
      "pipe:1"
    ];
  }

  return [...inputArgs, "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", "-write_xing", "0", "-flush_packets", "1", "pipe:1"];
}

function escapeDrawText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "%%").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/\[/g, "\\[").replace(/\]/g, "\\]").slice(0, 96);
}

function resolvePulseMonitorSource(): string {
  const configuredSource = process.env.YOUTOPIA_TV_AUDIO_SOURCE?.trim();
  if (configuredSource) return configuredSource;

  const pipewireSink = getDefaultPipewireSink();
  if (pipewireSink) {
    return pipewireSink + ".monitor";
  }

  const source = runCommand("pactl", ["get-default-sink"]);
  if (source) {
    return source + ".monitor";
  }

  return "default";
}

function getDefaultPipewireSink(): string | null {
  const inspectOutput = runCommand("wpctl", ["inspect", "@DEFAULT_AUDIO_SINK@"]);
  if (!inspectOutput) return null;

  const match = inspectOutput.match(new RegExp(PIPEWIRE_NODE_NAME_KEY.replace(".", "\\.") + '\\s*=\\s*"([^"]+)"'));
  return match ? match[1] : null;
}

function commandAvailable(command: string): boolean {
  const result = spawnSync(command, ["-version"], {
    stdio: "ignore",
    timeout: 1500
  });

  return !result.error && result.status === 0;
}

function ffmpegEncoderAvailable(encoder: string): boolean {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-h", `encoder=${encoder}`], {
    stdio: "ignore",
    timeout: 1500
  });

  return !result.error && result.status === 0;
}

function runCommand(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 1500
  });

  if (result.error || result.status !== 0) return null;

  const output = result.stdout.trim();
  return output.length > 0 ? output : null;
}
