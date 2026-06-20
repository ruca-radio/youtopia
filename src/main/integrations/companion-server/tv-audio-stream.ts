import { ChildProcessWithoutNullStreams, spawn, spawnSync } from "child_process";

export type TvAudioStream = {
  source: string;
  contentType: string;
  process: ChildProcessWithoutNullStreams;
  stop: () => void;
};

export type TvProgramStream = TvAudioStream;

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

const TV_PROGRAM_CONTENT_TYPE = "video/webm";
const PIPEWIRE_NODE_NAME_KEY = "node.name";

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

function getTvProgramFfmpegArgs(source: string, metadata: TvProgramMetadata): string[] {
  const title = escapeDrawText(metadata.title || "Youtopia");
  const artist = escapeDrawText(metadata.artist || "Server program feed");
  const filter = [
    "[0:a]asplit=2[aout][avis]",
    "[avis]showwaves=s=1280x720:mode=line:rate=30:colors=0xef4444|0x22c55e,format=yuv420p[v0]",
    `[v0]drawtext=text='${title}':x=58:y=54:fontsize=44:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=18[v1]`,
    `[v1]drawtext=text='${artist}':x=60:y=122:fontsize=26:fontcolor=0xd1d5db:box=1:boxcolor=black@0.35:boxborderw=12[v]`
  ].join(";");

  return [
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
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "[aout]",
    "-codec:v",
    "libvpx",
    "-deadline",
    "realtime",
    "-cpu-used",
    "6",
    "-b:v",
    "1800k",
    "-r",
    "30",
    "-g",
    "60",
    "-codec:a",
    "libopus",
    "-b:a",
    "160k",
    "-application",
    "lowdelay",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-f",
    "webm",
    "-live",
    "1",
    "-cluster_time_limit",
    "100",
    "-flush_packets",
    "1",
    "pipe:1"
  ];
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
      "20",
      "-f",
      "webm",
      "-live",
      "1",
      "-cluster_time_limit",
      "100",
      "-flush_packets",
      "1",
      "pipe:1"
    ];
  }

  return [...inputArgs, "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", "-write_xing", "0", "pipe:1"];
}

function escapeDrawText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/\[/g, "\\[").replace(/\]/g, "\\]").slice(0, 96);
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

function runCommand(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 1500
  });

  if (result.error || result.status !== 0) return null;

  const output = result.stdout.trim();
  return output.length > 0 ? output : null;
}
