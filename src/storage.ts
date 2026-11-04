import { S3Client } from "bun";
import sharp from "sharp";

// Railway bucket variables are mapped onto these names in the service settings
// (see README). Railway buckets use virtual-hosted style URLs by default.
const env = process.env;

export const storageConfigured = Boolean(
  env.S3_BUCKET && env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY,
);

if (!storageConfigured) {
  console.warn("S3_* variables are not set — photo uploads will fail until they are.");
}

const virtualHosted = (env.S3_URL_STYLE || "virtual-host") !== "path";

// With virtual-hosted style, Bun sends requests to the endpoint exactly as given,
// so the bucket has to be part of the host (https://<bucket>.<endpoint host>).
function resolveEndpoint(): string | undefined {
  const endpoint = env.S3_ENDPOINT;
  const bucket = env.S3_BUCKET;
  if (!endpoint || !bucket || !virtualHosted) return endpoint;
  try {
    const url = new URL(endpoint);
    if (!url.hostname.startsWith(`${bucket}.`)) url.hostname = `${bucket}.${url.hostname}`;
    return url.origin;
  } catch {
    return endpoint;
  }
}

export const s3 = new S3Client({
  bucket: env.S3_BUCKET,
  endpoint: resolveEndpoint(),
  region: env.S3_REGION || "auto",
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  virtualHostedStyle: virtualHosted,
});

/** Keys look like niches/<slug>/<id>.<ext> */
export const KEY_PATTERN = /^niches\/[a-z0-9-]{1,48}\/[a-z0-9]{6,24}\.(jpg|png|gif|webp|heic|avif)$/;

export async function putPhoto(key: string, data: Blob, type: string) {
  await s3.write(key, data, { type });
}

export async function deletePhotos(keys: string[]) {
  const thumbs = keys.map((k) => `thumbs/400/${k.replace(/\.[a-z0-9]+$/, "")}.webp`);
  await Promise.allSettled([...keys, ...thumbs].map((k) => s3.delete(k)));
}

export function photoFile(key: string) {
  return s3.file(key);
}

/**
 * Square WebP thumbnail for a photo, made on first request and kept in the
 * bucket under thumbs/. Returns null when the original can't be read or
 * decoded (for example HEIC), so callers can fall back to the original.
 */
export async function getThumb(key: string, size = 400): Promise<Blob | null> {
  const thumbKey = `thumbs/${size}/${key.replace(/\.[a-z0-9]+$/, "")}.webp`;
  const cached = s3.file(thumbKey);
  try {
    if (await cached.exists()) return new Blob([await cached.arrayBuffer()], { type: "image/webp" });
  } catch {}
  try {
    const original = Buffer.from(await s3.file(key).arrayBuffer());
    const out = await sharp(original, { failOn: "none" })
      .rotate()
      .resize(size, size, { fit: "cover", position: "attention" })
      .webp({ quality: 72 })
      .toBuffer();
    s3.write(thumbKey, out, { type: "image/webp" }).catch((err) => console.error("thumb save failed", err?.message));
    return new Blob([new Uint8Array(out)], { type: "image/webp" });
  } catch (err) {
    console.error("thumb failed", key, (err as Error)?.message);
    return null;
  }
}
