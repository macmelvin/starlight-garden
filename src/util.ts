// Small helpers shared across the server.

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function randomId(len = 6): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
  return `${base || "friend"}-${randomId(4)}`;
}

export function newKeeperToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Buffer.from(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- dates ----------

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2011-03-12" -> "12 March 2011" */
export function longDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function yearsLine(born: string | null, passed: string | null): string {
  const by = born?.slice(0, 4);
  const py = passed?.slice(0, 4);
  if (by && py) return `${by} – ${py}`;
  if (py) return `Passed ${py}`;
  if (by) return `Born ${by}`;
  return "";
}

export function datesLine(born: string | null, passed: string | null): string {
  if (born && passed) return `${longDate(born)} – ${longDate(passed)}`;
  if (passed) return `Passed ${longDate(passed)}`;
  if (born) return `Born ${longDate(born)}`;
  return "";
}

export function ageYears(born: string | null, passed: string | null): number | null {
  if (!born || !passed) return null;
  const [by, bm, bd] = born.split("-").map(Number);
  const [py, pm, pd] = passed.split("-").map(Number);
  let age = py - by;
  if (pm < bm || (pm === bm && pd < bd)) age--;
  return age >= 0 ? age : null;
}

export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function timeAgo(date: Date): string {
  const s = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return d === 1 ? "yesterday" : `${d} days ago`;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// ---------- rate limiting (in memory, per instance) ----------

const buckets = new Map<string, { count: number; reset: number }>();

export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
}, 10 * 60 * 1000).unref?.();

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// ---------- image sniffing ----------

export function sniffImage(head: Uint8Array): { ext: string; type: string } | null {
  const b = head;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", type: "image/png" };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { ext: "gif", type: "image/gif" };
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ext: "webp", type: "image/webp" };
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)) return { ext: "heic", type: "image/heic" };
    if (brand === "avif" || brand === "avis") return { ext: "avif", type: "image/avif" };
  }
  return null;
}

export const TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  avif: "image/avif",
};
