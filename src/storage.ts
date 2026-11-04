import { S3Client } from "bun";

// Railway bucket variables are mapped onto these names in the service settings
// (see README). Railway buckets use virtual-hosted style URLs by default.
const env = process.env;

export const storageConfigured = Boolean(
  env.S3_BUCKET && env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY,
);

if (!storageConfigured) {
  console.warn("S3_* variables are not set — photo uploads will fail until they are.");
}

export const s3 = new S3Client({
  bucket: env.S3_BUCKET,
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION || "auto",
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  virtualHostedStyle: (env.S3_URL_STYLE || "virtual-host") !== "path",
});

/** Keys look like niches/<slug>/<id>.<ext> */
export const KEY_PATTERN = /^niches\/[a-z0-9-]{1,48}\/[a-z0-9]{6,24}\.(jpg|png|gif|webp|heic|avif)$/;

export async function putPhoto(key: string, data: Blob, type: string) {
  await s3.write(key, data, { type });
}

export async function deletePhotos(keys: string[]) {
  await Promise.allSettled(keys.map((k) => s3.delete(k)));
}

export function photoFile(key: string) {
  return s3.file(key);
}
