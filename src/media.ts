// Video handling: check what was uploaded, measure it, and convert it to a
// small H.264 MP4 (plays everywhere, including iPhone HEVC clips on Android)
// plus a JPEG poster frame for the gallery.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_VIDEO_SECONDS = 60;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEOS_PER_NICHE = 3;

// ISO media files whose brand marks them as still images rather than video
const IMAGE_BRANDS = ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1", "avif", "avis"];

/** Recognises MP4 / MOV / 3GP / WebM from the first bytes. */
export function sniffVideo(head: Uint8Array): boolean {
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true; // WebM / Matroska
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (ascii(4, 8) === "ftyp") return !IMAGE_BRANDS.includes(ascii(8, 12));
  // old QuickTime files start with a moov / mdat / wide / free atom
  return ["moov", "mdat", "wide", "free", "skip"].includes(ascii(4, 8));
}

export const videoToolsAvailable = Boolean(Bun.which("ffmpeg") && Bun.which("ffprobe"));
if (!videoToolsAvailable) console.warn("ffmpeg/ffprobe not found — video uploads are turned off.");

// At most two conversions at a time, so a burst of uploads can't swamp the server.
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

async function run(cmd: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { code, out, err };
}

export type ProcessedVideo = { video: Uint8Array; poster: Uint8Array; duration: number };

export class VideoError extends Error {}

export async function processVideo(file: File): Promise<ProcessedVideo> {
  if (!videoToolsAvailable) throw new VideoError("Video uploads aren't available right now. Please add photos instead.");
  return slot(async () => {
    const dir = await mkdtemp(join(tmpdir(), "sg-video-"));
    try {
      const input = join(dir, "in");
      const output = join(dir, "out.mp4");
      const poster = join(dir, "poster.jpg");
      await Bun.write(input, file);

      const probe = await run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "format=duration:stream=codec_type", "-of", "json", input],
        30_000,
      );
      let duration = NaN;
      let hasVideo = false;
      try {
        const info = JSON.parse(probe.out);
        duration = Number(info?.format?.duration);
        hasVideo = Array.isArray(info?.streams) && info.streams.some((s: { codec_type?: string }) => s.codec_type === "video");
      } catch {}
      if (!hasVideo || !Number.isFinite(duration)) throw new VideoError("We couldn't read one of the videos. Please try a different file.");
      if (duration > MAX_VIDEO_SECONDS + 0.5) {
        throw new VideoError(`Videos can be up to ${MAX_VIDEO_SECONDS} seconds. Please trim it on your phone first.`);
      }

      const conv = await run(
        [
          "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
          "-i", input,
          "-t", String(MAX_VIDEO_SECONDS),
          "-map", "0:v:0", "-map", "0:a:0?",
          "-vf", "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',format=yuv420p",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-profile:v", "high",
          "-c:a", "aac", "-b:a", "128k", "-ac", "2",
          "-movflags", "+faststart",
          output,
        ],
        180_000,
      );
      if (conv.code !== 0) {
        console.error("ffmpeg failed", conv.err.slice(-500));
        throw new VideoError("We couldn't prepare one of the videos. Please try a different file.");
      }
      const shot = await run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", String(Math.min(0.8, duration / 2)), "-i", output, "-frames:v", "1", "-q:v", "3", poster],
        30_000,
      );
      if (shot.code !== 0) throw new VideoError("We couldn't prepare one of the videos. Please try a different file.");

      return {
        video: new Uint8Array(await Bun.file(output).arrayBuffer()),
        poster: new Uint8Array(await Bun.file(poster).arrayBuffer()),
        duration: Math.round(duration * 10) / 10,
      };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}
