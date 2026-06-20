#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const playlistUrl = process.argv[2] ?? "http://127.0.0.1:9863/tv/program.m3u8";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node scripts/probe-firetv-hls-volume.mjs [playlist-url]");
  console.log("Requires a running Youtopia companion server plus ffmpeg and ffprobe on PATH.");
  process.exit(0);
}

function requireCommand(command) {
  const result = spawnSync(command, ["-version"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} is required on PATH`);
  }
}

async function download(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function latestSegmentUrl(baseUrl, playlist) {
  const segment = playlist
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"))
    .at(-1);

  if (!segment) {
    throw new Error("playlist did not include a media segment");
  }

  return new URL(segment, baseUrl).toString();
}

requireCommand("ffmpeg");
requireCommand("ffprobe");

const playlistResponse = await fetch(playlistUrl, { cache: "no-store" });
if (!playlistResponse.ok) {
  throw new Error(`${playlistUrl} returned HTTP ${playlistResponse.status}`);
}

const playlist = await playlistResponse.text();
if (!playlist.includes("#EXTINF")) {
  throw new Error("playlist is not ready yet; wait for the HLS stream to warm up and retry");
}

const segmentUrl = latestSegmentUrl(playlistUrl, playlist);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "youtopia-hls-probe-"));
const segmentPath = path.join(tempDir, path.basename(new URL(segmentUrl).pathname) || "segment.ts");
fs.writeFileSync(segmentPath, await download(segmentUrl));

const probe = spawnSync(
  "ffprobe",
  [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=codec_name",
    "-of",
    "default=nw=1:nk=1",
    segmentPath
  ],
  { encoding: "utf8" }
);
if (probe.status !== 0 || !probe.stdout.trim()) {
  throw new Error(`ffprobe could not find an audio stream in ${segmentPath}`);
}

const volume = spawnSync(
  "ffmpeg",
  ["-hide_banner", "-i", segmentPath, "-af", "volumedetect", "-f", "null", "-"],
  { encoding: "utf8" }
);
const volumeOutput = `${volume.stdout}\n${volume.stderr}`;
if (volume.status !== 0 || !volumeOutput.includes("mean_volume") || !volumeOutput.includes("max_volume")) {
  throw new Error(`ffmpeg volumedetect did not report segment volume for ${segmentPath}`);
}

console.log(`Playlist: ${playlistUrl}`);
console.log(`Segment: ${segmentUrl}`);
console.log(`Audio codec: ${probe.stdout.trim()}`);
console.log(volumeOutput.split(/\r?\n/).filter(line => /mean_volume|max_volume/.test(line)).join("\n"));
