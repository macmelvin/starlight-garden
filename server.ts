import { join } from "node:path";
import { analyticsOrigins } from "./src/analytics";
import { createCheckout, getCheckout, getGift, giftsEnabled, verifyWebhook } from "./src/gifts";
import { MAX_VIDEO_BYTES, MAX_VIDEOS_PER_NICHE, VideoError, processVideo, sniffVideo, videoToolsAvailable } from "./src/media";
import { KINDS, activeGifts, createGiftRow, findGiftBySession, giftSales, keeperGifts, markGiftPaid, setGiftHidden, setGiftSession, addReminder, exportReminders, findReminder, reminderCounts, unsubscribeReminder, countNiches, getNiche, getNotes, getPhotos, listNiches, listPortraits, migrate, sql } from "./src/db";
import { KEY_PATTERN, deletePhotos, getThumb, photoFile, putPhoto, s3, storageConfigured } from "./src/storage";
import {
  allow, cleanEmail, clientIp, hashToken, petFirstName, isIsoDate, newKeeperToken, randomId, safeEqual, slugify, sniffImage, TYPE_BY_EXT,
} from "./src/util";
import { adminListPage, adminLoginPage, createPage, homePage, privacyPage, unsubscribePage, keeperPage, messagePage, nichePage, noteItem, reminderIcs, skyPage } from "./src/views";

const PORT = Number(process.env.PORT ?? 3000);
const MAX_PHOTOS = 12;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const PUBLIC_DIR = join(import.meta.dir, "public");

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    ["script-src 'self'", ...analyticsOrigins].join(" "),
    ["connect-src 'self'", ...analyticsOrigins].join(" "),
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join("; "),
};

function baseUrl(req: Request): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

function html(body: string, status = 200, extra: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS, ...extra },
  });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...SECURITY_HEADERS },
  });
}

function notFound() {
  const p = messagePage("We couldn't find that niche", "It may have been moved or taken down by its keeper.");
  return html(p.html, p.status);
}

// Only accept JSON/form posts from our own pages.
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(baseUrl(req)).host || new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

function text(form: FormData, name: string, max: number): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Owner key check. Only wrong guesses count towards the lockout. */
const adminFails = new Map<string, { count: number; reset: number }>();
function adminKeyCheck(req: Request, key: string): "ok" | "wrong" | "locked" {
  const expected = process.env.ADMIN_KEY ?? "";
  if (expected.length < 16) return "wrong";
  const ip = clientIp(req);
  const now = Date.now();
  const f = adminFails.get(ip);
  if (f && f.reset > now && f.count >= 10) return "locked";
  if (safeEqual(hashToken(key.trim()), hashToken(expected))) return "ok";
  if (!f || f.reset <= now) adminFails.set(ip, { count: 1, reset: now + 60 * 60 * 1000 });
  else f.count++;
  return "wrong";
}

function adminDenied(result: "wrong" | "locked") {
  return html(
    adminLoginPage(result === "locked" ? "Too many wrong tries. Please wait an hour and try again." : "That key isn't right."),
    403,
    { "Cache-Control": "no-store" },
  );
}

async function verifyKeeper(slug: string, token: unknown) {
  if (typeof token !== "string" || token.length < 10) return null;
  const niche = await getNiche(slug);
  if (!niche) return null;
  return safeEqual(hashToken(token), niche.keeper_token_hash) ? niche : null;
}

// ---------- handlers ----------

type CheckedMedia = { file: File; media: "image" | "video"; ext: string; type: string };
type StoredMedia = { key: string; media: "image" | "video"; posterKey: string | null; duration: number | null };

async function checkMedia(files: File[]): Promise<{ ok: CheckedMedia[] } | { error: string }> {
  const ok: CheckedMedia[] = [];
  for (const file of files) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const image = sniffImage(head);
    if (image) {
      if (file.size > MAX_PHOTO_BYTES) return { error: "One of the photos is too large (15 MB max)." };
      ok.push({ file, media: "image", ...image });
      continue;
    }
    if (sniffVideo(head)) {
      if (!videoToolsAvailable) return { error: "Video uploads aren't available right now. Please add photos instead." };
      if (file.size > MAX_VIDEO_BYTES) return { error: "One of the videos is too large (100 MB max). Try a shorter clip." };
      ok.push({ file, media: "video", ext: "mp4", type: "video/mp4" });
      continue;
    }
    return { error: "One of the files isn't a supported photo or video." };
  }
  if (ok.filter((m) => m.media === "video").length > MAX_VIDEOS_PER_NICHE) {
    return { error: `Please choose up to ${MAX_VIDEOS_PER_NICHE} videos.` };
  }
  return { ok };
}

/** Stores every item or none. Videos are converted first. */
async function uploadMedia(slug: string, items: CheckedMedia[]): Promise<{ ok: StoredMedia[] } | { error: string; status: number }> {
  const stored: StoredMedia[] = [];
  const allKeys = () => stored.flatMap((m) => (m.posterKey ? [m.key, m.posterKey] : [m.key]));
  try {
    for (const item of items) {
      const id = randomId(12);
      if (item.media === "image") {
        const key = `niches/${slug}/${id}.${item.ext}`;
        await putPhoto(key, item.file, item.type);
        stored.push({ key, media: "image", posterKey: null, duration: null });
      } else {
        const v = await processVideo(item.file);
        const key = `niches/${slug}/${id}.mp4`;
        const posterKey = `niches/${slug}/${id}.jpg`;
        await putPhoto(key, v.video, "video/mp4");
        stored.push({ key, media: "video", posterKey: null, duration: v.duration });
        await putPhoto(posterKey, v.poster, "image/jpeg");
        stored[stored.length - 1].posterKey = posterKey;
      }
    }
    return { ok: stored };
  } catch (err) {
    await deletePhotos(allKeys());
    if (err instanceof VideoError) return { error: err.message, status: 400 };
    console.error("upload failed", err);
    return { error: "We couldn't save the photos. Please try again.", status: 502 };
  }
}

type Details = {
  name: string;
  kind: string;
  born: string | null;
  passed: string | null;
  plaqueLine: string | null;
  story: string | null;
  keeperName: string | null;
};

/** Reads and checks the niche's written details from any source of fields. */
function readDetails(get: (name: string, max: number) => string): Details | { error: string } {
  const name = petFirstName(get("name", 60));
  const kindRaw = get("kind", 30);
  const kind = (KINDS as readonly string[]).includes(kindRaw) ? kindRaw : "Other friend";
  const born = get("born", 10) || null;
  const passed = get("passed", 10) || null;
  if (!name) return { error: "Please add their name." };
  const today = new Date().toISOString().slice(0, 10);
  for (const [label, d] of [["birth", born], ["passing", passed]] as const) {
    if (d && (!isIsoDate(d) || d > today)) return { error: `Please check the ${label} date.` };
  }
  if (born && passed && born > passed) return { error: "The birth date should come before the date they passed." };
  return {
    name,
    kind,
    born,
    passed,
    plaqueLine: get("plaque_line", 80) || null,
    story: get("story", 4000) || null,
    keeperName: get("keeper_name", 60) || null,
  };
}

async function createNiche(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Please create the niche from this site." }, 403);
  if (!storageConfigured) return json({ error: "Photo storage isn't set up yet. Please try again later." }, 503);
  const ip = clientIp(req);
  if (!allow(`create:${ip}`, 8, 60 * 60 * 1000)) {
    return json({ error: "You've created several niches in a short time. Please wait a little and try again." }, 429);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "We couldn't read the form. Please try again." }, 400);
  }

  const details = readDetails((n, max) => text(form, n, max));
  if ("error" in details) return json({ error: details.error }, 400);
  const { name, kind, born, passed, plaqueLine, story, keeperName } = details;
  const portraitIndex = Math.max(0, Number(text(form, "portrait", 3)) || 0);
  const wantsReminder = text(form, "remind_me", 10) === "on" || text(form, "remind_me", 10) === "true";
  const reminderEmail = wantsReminder ? cleanEmail(text(form, "remind_email", 254)) : null;
  if (wantsReminder && !reminderEmail) return json({ error: "Please check your email address for the reminders." }, 400);

  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return json({ error: "Please add at least one photo." }, 400);
  if (files.length > MAX_PHOTOS) return json({ error: `Please choose up to ${MAX_PHOTOS} photos and videos.` }, 400);

  const checked = await checkMedia(files);
  if ("error" in checked) return json({ error: checked.error }, 400);
  if (!checked.ok.some((m) => m.media === "image")) return json({ error: "Please add at least one photo for their portrait." }, 400);

  const slug = slugify(name);
  const result = await uploadMedia(slug, checked.ok);
  if ("error" in result) return json({ error: result.error }, result.status);
  const uploaded = result.ok;
  const allKeys = uploaded.flatMap((m) => (m.posterKey ? [m.key, m.posterKey] : [m.key]));

  const chosen = uploaded[Math.min(portraitIndex, uploaded.length - 1)];
  const portraitKey = chosen.media === "image" ? chosen.key : uploaded.find((m) => m.media === "image")!.key;
  const token = newKeeperToken();
  let nicheId = 0;
  try {
    await sql.begin(async (tx) => {
      const [row] = await tx`
        INSERT INTO niches (slug, name, kind, born, passed, plaque_line, story, keeper_name, keeper_token_hash, portrait_key)
        VALUES (${slug}, ${name}, ${kind}, ${born}::date, ${passed}::date, ${plaqueLine}, ${story}, ${keeperName}, ${hashToken(token)}, ${portraitKey})
        RETURNING id`;
      nicheId = row.id;
      // portrait first, then the rest in the order chosen
      const ordered = [uploaded.find((m) => m.key === portraitKey)!, ...uploaded.filter((m) => m.key !== portraitKey)];
      for (let i = 0; i < ordered.length; i++) {
        const m = ordered[i];
        await tx`INSERT INTO photos (niche_id, key, position, media, poster_key, duration)
                 VALUES (${row.id}, ${m.key}, ${i}, ${m.media}, ${m.posterKey}, ${m.duration})`;
      }
    });
  } catch (err) {
    console.error("db insert failed", err);
    await deletePhotos(allKeys);
    return json({ error: "We couldn't create the niche. Please try again." }, 500);
  }

  if (reminderEmail && nicheId) {
    await addReminder(nicheId, name, reminderEmail, "keeper", newKeeperToken()).catch((err) => console.error("reminder save failed", err));
  }

  const base = baseUrl(req);
  return json({
    slug,
    url: `${base}/pet/${slug}`,
    keeperUrl: `${base}/keeper/${slug}?token=${encodeURIComponent(token)}`,
    shareUrl: `https://wa.me/?text=${encodeURIComponent(
      `${name} has a little niche at Starlight Garden. If ${name} ever made you smile, come visit and send a little light too: ${base}/pet/${slug}`,
    )}`,
  });
}

async function tribute(req: Request, slug: string, kind: "candle" | "flower") {
  if (!sameOrigin(req)) return json({ error: "Not allowed" }, 403);
  const ip = clientIp(req);
  if (!allow(`${kind}:${ip}`, 60, 60 * 60 * 1000)) return json({ error: "Please slow down a little." }, 429);
  const once = allow(`${kind}:${ip}:${slug}`, 1, 12 * 60 * 60 * 1000);
  const niche = await getNiche(slug);
  if (!niche) return json({ error: "Niche not found" }, 404);
  if (!once) return json({ candles: niche.candles, flowers: niche.flowers, repeat: true });
  const rows =
    kind === "candle"
      ? await sql`UPDATE niches SET candles = candles + 1 WHERE id = ${niche.id} RETURNING candles, flowers`
      : await sql`UPDATE niches SET flowers = flowers + 1 WHERE id = ${niche.id} RETURNING candles, flowers`;
  return json(rows[0]);
}

async function addNote(req: Request, slug: string) {
  if (!sameOrigin(req)) return json({ error: "Not allowed" }, 403);
  const ip = clientIp(req);
  if (!allow(`note:${ip}`, 15, 60 * 60 * 1000)) {
    return json({ error: "You've left several notes in a short time. Please wait a little and try again." }, 429);
  }
  let data: { body?: unknown; author?: unknown };
  try {
    data = await req.json();
  } catch {
    return json({ error: "Please try again." }, 400);
  }
  const body = typeof data.body === "string" ? data.body.trim().slice(0, 600) : "";
  const author = typeof data.author === "string" ? data.author.trim().slice(0, 60) || null : null;
  if (!body) return json({ error: "Please write a few words first." }, 400);
  const niche = await getNiche(slug);
  if (!niche) return json({ error: "Niche not found" }, 404);
  const [note] = await sql`
    INSERT INTO notes (niche_id, author, body) VALUES (${niche.id}, ${author}, ${body})
    RETURNING id, author, body, created_at`;
  return json({ html: noteItem(note) });
}

async function keeperAction(req: Request, slug: string, action: "remove-note" | "delete") {
  if (!sameOrigin(req)) return json({ error: "Not allowed" }, 403);
  if (!allow(`keeper:${clientIp(req)}`, 60, 60 * 60 * 1000)) return json({ error: "Please slow down a little." }, 429);
  let data: { token?: unknown; noteId?: unknown };
  try {
    data = await req.json();
  } catch {
    return json({ error: "Please try again." }, 400);
  }
  const niche = await verifyKeeper(slug, data.token);
  if (!niche) return json({ error: "This keeper link isn't valid." }, 403);
  if (action === "remove-note") {
    const id = Number(data.noteId);
    if (!Number.isInteger(id)) return json({ error: "Unknown note" }, 400);
    await sql`DELETE FROM notes WHERE id = ${id} AND niche_id = ${niche.id}`;
    return json({ ok: true });
  }
  const photos = await getPhotos(niche.id);
  await sql`DELETE FROM niches WHERE id = ${niche.id}`;
  await deletePhotos(photos.flatMap((p) => (p.poster_key ? [p.key, p.poster_key] : [p.key])));
  return json({ ok: true });
}

type KeeperCtx =
  | { ok: true; niche: NonNullable<Awaited<ReturnType<typeof getNiche>>>; data: Record<string, unknown> }
  | { ok: false; error: Response };

async function keeperFromJson(req: Request, slug: string): Promise<KeeperCtx> {
  if (!sameOrigin(req)) return { ok: false, error: json({ error: "Not allowed" }, 403) };
  if (!allow(`keeper:${clientIp(req)}`, 120, 60 * 60 * 1000)) return { ok: false, error: json({ error: "Please slow down a little." }, 429) };
  let data: Record<string, unknown>;
  try {
    data = await req.json();
  } catch {
    return { ok: false, error: json({ error: "Please try again." }, 400) };
  }
  const niche = await verifyKeeper(slug, data.token);
  if (!niche) return { ok: false, error: json({ error: "This keeper link isn't valid." }, 403) };
  return { ok: true, niche, data };
}

async function keeperDetails(req: Request, slug: string) {
  const r = await keeperFromJson(req, slug);
  if (!r.ok) return r.error;
  const { niche, data } = r;
  const details = readDetails((n, max) => (typeof data[n] === "string" ? (data[n] as string).trim().slice(0, max) : ""));
  if ("error" in details) return json({ error: details.error }, 400);
  await sql`
    UPDATE niches SET
      name = ${details.name}, kind = ${details.kind},
      born = ${details.born}::date, passed = ${details.passed}::date,
      plaque_line = ${details.plaqueLine}, story = ${details.story}, keeper_name = ${details.keeperName}
    WHERE id = ${niche.id}`;
  return json({ ok: true });
}

async function keeperPhotoAction(req: Request, slug: string, action: "portrait" | "remove" | "move") {
  const r = await keeperFromJson(req, slug);
  if (!r.ok) return r.error;
  const { niche, data } = r;
  const photos = await getPhotos(niche.id);
  const id = Number(data.photoId);
  const index = photos.findIndex((p) => p.id === id);
  if (index < 0) return json({ error: "That photo wasn't found. Please refresh the page." }, 404);
  const photo = photos[index];

  if (action === "portrait") {
    if (photo.media !== "image") return json({ error: "The portrait needs to be a photo, not a video." }, 400);
    await sql`UPDATE niches SET portrait_key = ${photo.key} WHERE id = ${niche.id}`;
    return json({ ok: true });
  }

  if (action === "remove") {
    const rest = photos.filter((p) => p.id !== id);
    if (!rest.some((p) => p.media === "image")) {
      return json({ error: "A niche needs at least one photo. Add another photo before removing this one." }, 400);
    }
    await sql.begin(async (tx) => {
      await tx`DELETE FROM photos WHERE id = ${id} AND niche_id = ${niche.id}`;
      if (niche.portrait_key === photo.key) {
        await tx`UPDATE niches SET portrait_key = ${rest.find((p) => p.media === "image")!.key} WHERE id = ${niche.id}`;
      }
      for (let i = 0; i < rest.length; i++) await tx`UPDATE photos SET position = ${i} WHERE id = ${rest[i].id}`;
    });
    await deletePhotos(photo.poster_key ? [photo.key, photo.poster_key] : [photo.key]);
    return json({ ok: true });
  }

  // move one step earlier or later
  const dir = data.direction === "earlier" ? -1 : 1;
  const target = index + dir;
  if (target < 0 || target >= photos.length) return json({ ok: true });
  const order = photos.map((p) => p.id);
  [order[index], order[target]] = [order[target], order[index]];
  await sql.begin(async (tx) => {
    for (let i = 0; i < order.length; i++) await tx`UPDATE photos SET position = ${i} WHERE id = ${order[i]} AND niche_id = ${niche.id}`;
  });
  return json({ ok: true });
}

async function keeperAddPhotos(req: Request, slug: string) {
  if (!sameOrigin(req)) return json({ error: "Not allowed" }, 403);
  if (!storageConfigured) return json({ error: "Photo storage isn't set up yet. Please try again later." }, 503);
  if (!allow(`keeper-upload:${clientIp(req)}`, 30, 60 * 60 * 1000)) return json({ error: "Please slow down a little." }, 429);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "We couldn't read the photos. Please try again." }, 400);
  }
  const niche = await verifyKeeper(slug, form.get("token"));
  if (!niche) return json({ error: "This keeper link isn't valid." }, 403);
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return json({ error: "Please choose at least one photo or video." }, 400);
  const existing = await getPhotos(niche.id);
  const room = MAX_PHOTOS - existing.length;
  if (room <= 0) return json({ error: `This niche already has ${MAX_PHOTOS} photos and videos. Remove one to add another.` }, 400);
  if (files.length > room) return json({ error: `You can add ${room} more (${MAX_PHOTOS} photos and videos at most).` }, 400);
  const checked = await checkMedia(files);
  if ("error" in checked) return json({ error: checked.error }, 400);
  const videosAfter = existing.filter((p) => p.media === "video").length + checked.ok.filter((m) => m.media === "video").length;
  if (videosAfter > MAX_VIDEOS_PER_NICHE) return json({ error: `A niche can hold up to ${MAX_VIDEOS_PER_NICHE} videos.` }, 400);
  const result = await uploadMedia(niche.slug, checked.ok);
  if ("error" in result) return json({ error: result.error }, result.status);
  const items = result.ok;
  try {
    await sql.begin(async (tx) => {
      for (let i = 0; i < items.length; i++) {
        const m = items[i];
        await tx`INSERT INTO photos (niche_id, key, position, media, poster_key, duration)
                 VALUES (${niche.id}, ${m.key}, ${existing.length + i}, ${m.media}, ${m.posterKey}, ${m.duration})`;
      }
    });
  } catch (err) {
    console.error("db insert failed", err);
    await deletePhotos(items.flatMap((m) => (m.posterKey ? [m.key, m.posterKey] : [m.key])));
    return json({ error: "We couldn't add them. Please try again." }, 500);
  }
  return json({ ok: true, added: items.length });
}

async function remindMe(req: Request, slug: string) {
  if (!sameOrigin(req)) return json({ error: "Not allowed" }, 403);
  if (!allow(`remind:${clientIp(req)}`, 20, 60 * 60 * 1000)) return json({ error: "Please try again a little later." }, 429);
  let data: { email?: unknown; consent?: unknown };
  try {
    data = await req.json();
  } catch {
    return json({ error: "Please try again." }, 400);
  }
  if (data.consent !== true) return json({ error: "Please tick the box to agree to the reminder emails." }, 400);
  const email = cleanEmail(data.email);
  if (!email) return json({ error: "Please check your email address." }, 400);
  const niche = await getNiche(slug);
  if (!niche) return json({ error: "Niche not found" }, 404);
  await addReminder(niche.id, niche.name, email, "visitor", newKeeperToken());
  return json({ ok: true });
}

function csvCell(v: unknown): string {
  let t = v instanceof Date ? v.toISOString() : String(v ?? "");
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // stop spreadsheet formulas
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

async function startGift(req: Request, slug: string) {
  if (!sameOrigin(req)) return json({ error: "Not allowed" }, 403);
  if (!giftsEnabled()) return json({ error: "Gifts aren't available yet." }, 503);
  if (!allow(`gift:${clientIp(req)}`, 30, 60 * 60 * 1000)) return json({ error: "Please try again a little later." }, 429);
  let data: { gift?: unknown; from_name?: unknown; message?: unknown };
  try {
    data = await req.json();
  } catch {
    return json({ error: "Please try again." }, 400);
  }
  const gift = getGift(data.gift);
  if (!gift) return json({ error: "Please choose a gift." }, 400);
  const niche = await getNiche(slug);
  if (!niche) return json({ error: "Niche not found" }, 404);
  const fromName = typeof data.from_name === "string" ? data.from_name.trim().slice(0, 40) || null : null;
  const message = typeof data.message === "string" ? data.message.trim().slice(0, 120) || null : null;
  const rowId = await createGiftRow(niche.id, gift.id, fromName, message, gift.cents, gift.days);
  const base = baseUrl(req);
  try {
    const session = await createCheckout({
      gift,
      petName: niche.name,
      giftRowId: rowId,
      successUrl: `${base}/pet/${niche.slug}?gift={CHECKOUT_SESSION_ID}#gifts`,
      cancelUrl: `${base}/pet/${niche.slug}#gifts`,
    });
    await setGiftSession(rowId, session.id);
    return json({ url: session.url });
  } catch {
    return json({ error: "We couldn't open the payment page. Please try again." }, 502);
  }
}

/** Confirms a paid checkout (from the return redirect or the webhook). Returns the gift id if paid. */
async function confirmGift(sessionId: string): Promise<string | null> {
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(sessionId)) return null;
  const row = await findGiftBySession(sessionId);
  if (!row) return null;
  if (row.status === "paid") return row.gift;
  const session = await getCheckout(sessionId);
  if (session.payment_status !== "paid" || session.metadata?.gift_row_id !== String(row.id) || session.currency !== "sgd") return null;
  const done = await markGiftPaid(row.id, sessionId, session.amount_total);
  if (done) console.log(`Gift paid: ${row.gift} for niche ${row.niche_id}`);
  return row.gift;
}

async function stripeWebhook(req: Request) {
  const payload = await req.text();
  const event = await verifyWebhook(payload, req.headers.get("stripe-signature"));
  if (!event) return new Response("Invalid signature", { status: 400 });
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const id = event.data?.object?.id;
    if (typeof id === "string") await confirmGift(id).catch((err) => console.error("webhook confirm failed", err));
  }
  return new Response("ok");
}

async function servePhoto(req: Request) {
  const key = decodeURIComponent(new URL(req.url).pathname.replace(/^\/photo\//, ""));
  if (!KEY_PATTERN.test(key)) return new Response("Not found", { status: 404 });
  const file = photoFile(key);
  try {
    const ext = key.split(".").pop()!;
    const type = TYPE_BY_EXT[ext] ?? "application/octet-stream";
    const stat = await file.stat();
    const size = stat.size;
    const base = {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    };
    // Videos need byte ranges (iPhones won't play them otherwise)
    const range = req.headers.get("range");
    const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      let end = m[1] && m[2] ? Number(m[2]) : size - 1;
      end = Math.min(end, size - 1);
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      // A buffered body (not a stream) so the exact Content-Length is sent; converted
      // videos are small, and iPhones are strict about partial responses.
      const chunk = await file.slice(start, end + 1).arrayBuffer();
      return new Response(chunk, {
        status: 206,
        headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
      });
    }
    // stream rather than redirect so link previews (WhatsApp) can read it
    return new Response(file.stream(), { headers: { ...base, "Content-Length": String(size) } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function serveThumb(req: Request) {
  const key = decodeURIComponent(new URL(req.url).pathname.replace(/^\/thumb\//, ""));
  if (!KEY_PATTERN.test(key)) return new Response("Not found", { status: 404 });
  const data = await getThumb(key);
  if (!data) return Response.redirect(`/photo/${key}`, 302);
  return new Response(data, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const STATIC_TYPES: Record<string, string> = {
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
};

async function serveStatic(req: Request) {
  const name = new URL(req.url).pathname.replace(/^\/static\//, "");
  if (!/^[a-z0-9-]+\.(css|js|svg|png)$/.test(name)) return new Response("Not found", { status: 404 });
  const file = Bun.file(join(PUBLIC_DIR, name));
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file, {
    headers: {
      "Content-Type": STATIC_TYPES[name.split(".").pop()!],
      "Cache-Control": "public, max-age=86400",
    },
  });
}

function safe(handler: (req: Request & { params: Record<string, string> }) => Promise<Response> | Response) {
  return async (req: Request & { params: Record<string, string> }) => {
    try {
      return await handler(req);
    } catch (err) {
      console.error(req.method, req.url, err);
      if (new URL(req.url).pathname.startsWith("/api/")) return json({ error: "Something went wrong. Please try again." }, 500);
      const p = messagePage("Something went wrong", "Please try again in a moment.", 500);
      return html(p.html, p.status);
    }
  };
}

// ---------- server ----------

await migrate().catch((err) => {
  console.error("Database migration failed:", err);
});

if (storageConfigured) {
  s3.list({ maxKeys: 1 })
    .then(() => console.log("Photo storage connected"))
    .catch((err) => console.error("Photo storage check failed:", err?.code ?? "", err?.message ?? err));
}

const server = Bun.serve({
  port: PORT,
  maxRequestBodySize: 9 * MAX_PHOTO_BYTES + MAX_VIDEOS_PER_NICHE * MAX_VIDEO_BYTES + 4 * 1024 * 1024,
  routes: {
    "/healthz": () => new Response("ok"),
    "/static/*": safe(serveStatic),
    "/photo/*": safe(servePhoto),
    "/thumb/*": safe(serveThumb),

    "/": safe(async (req) => {
      const url = new URL(req.url);
      const q = (url.searchParams.get("q") ?? "").slice(0, 60);
      const kindParam = url.searchParams.get("kind") ?? "all";
      const kind = ["all", "dogs", "cats", "small"].includes(kindParam) ? kindParam : "all";
      const [niches, total, portraits] = await Promise.all([listNiches({ q, kind }), countNiches(), listPortraits(30)]);
      return html(homePage({ niches, q, kind, total, portraits, base: baseUrl(req) }));
    }),

    "/create": safe((req) => html(createPage(baseUrl(req)))),

    "/sky": safe(async (req) => {
      const selected = new URL(req.url).searchParams.get("pet") ?? undefined;
      const niches = await listNiches({ limit: 300 });
      return html(skyPage({ niches, selected, base: baseUrl(req) }));
    }),

    "/pet/:slug": safe(async (req) => {
      const niche = await getNiche(req.params.slug);
      if (!niche) return notFound();
      const sessionId = new URL(req.url).searchParams.get("gift");
      const thanks = sessionId && giftsEnabled() ? await confirmGift(sessionId).catch(() => null) : null;
      const [photos, notes, gifts] = await Promise.all([getPhotos(niche.id), getNotes(niche.id), activeGifts(niche.id)]);
      return html(nichePage({ niche, photos, notes, gifts, shopOpen: giftsEnabled(), thanks, base: baseUrl(req) }), 200, sessionId ? { "Cache-Control": "no-store" } : {});
    }),

    "/pet/:slug/remember.ics": safe(async (req) => {
      const niche = await getNiche(req.params.slug);
      if (!niche || !niche.passed) return notFound();
      const only = "passing" as const;
      const body = reminderIcs(niche, `${baseUrl(req)}/pet/${niche.slug}`, only);
      const file = `${niche.slug}-remembrance.ics`;
      return new Response(body, {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `inline; filename="${file}"`,
          "Cache-Control": "no-store",
        },
      });
    }),

    "/privacy": safe(() => html(privacyPage())),
    "/unsubscribe": {
      GET: safe(async (req) => {
        const t = new URL(req.url).searchParams.get("t") ?? "";
        const r = t ? await findReminder(t) : null;
        if (!r) {
          const p = messagePage("This link isn't valid", "It may have been copied incompletely. Every reminder email has its own unsubscribe link.", 404);
          return html(p.html, p.status);
        }
        return html(unsubscribePage({ token: t, name: r.name, email: r.email, done: false, already: !!r.unsubscribed_at }), 200, { "Cache-Control": "no-store" });
      }),
      POST: safe(async (req) => {
        const form = await req.formData().catch(() => null);
        const t = form ? String(form.get("t") ?? "") : new URL(req.url).searchParams.get("t") ?? "";
        const r = t ? await findReminder(t) : null;
        if (!r) {
          const p = messagePage("This link isn't valid", "It may have been copied incompletely.", 404);
          return html(p.html, p.status);
        }
        await unsubscribeReminder(r.id);
        console.log(`Reminder unsubscribed for ${r.slug}`);
        return html(unsubscribePage({ token: t, name: r.name, email: r.email, done: true, already: false }), 200, { "Cache-Control": "no-store" });
      }),
    },
    "/admin/reminders.csv": {
      POST: safe(async (req) => {
        if (!sameOrigin(req)) return new Response("Not allowed", { status: 403 });
        const form = await req.formData().catch(() => null);
        const key = form ? String(form.get("key") ?? "") : "";
        const check = adminKeyCheck(req, key);
        if (check !== "ok") return adminDenied(check);
        const base = baseUrl(req);
        const rows = await exportReminders();
        const header = ["email", "role", "pet", "niche_link", "remembrance_day", "consented_at", "consent_wording", "unsubscribe_link"];
        const lines = [header.join(",")].concat(
          rows.map((r) =>
            [r.email, r.role, r.pet, `${base}/pet/${r.slug}`, r.remembrance_day ?? "", r.consent_at, r.consent_text, `${base}/unsubscribe?t=${r.unsubscribe_token}`]
              .map(csvCell)
              .join(","),
          ),
        );
        return new Response("\uFEFF" + lines.join("\r\n") + "\r\n", {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="starlight-garden-reminders-${new Date().toISOString().slice(0, 10)}.csv"`,
            "Cache-Control": "no-store",
          },
        });
      }),
    },
    "/admin": {
      GET: safe(() => html(adminLoginPage(), 200, { "Cache-Control": "no-store", "Referrer-Policy": "same-origin" })),
      POST: safe(async (req) => {
        const form = await req.formData().catch(() => null);
        const key = form ? String(form.get("key") ?? "") : "";
        const check = adminKeyCheck(req, key);
        if (check !== "ok") return adminDenied(check);
        const [niches, counts, sales] = await Promise.all([listNiches({ limit: 500 }), reminderCounts(), giftSales()]);
        return html(adminListPage(niches, key, undefined, counts, sales), 200, { "Cache-Control": "no-store", "Referrer-Policy": "same-origin" });
      }),
    },
    "/admin/keeper-link": {
      POST: safe(async (req) => {
        if (!sameOrigin(req)) return new Response("Not allowed", { status: 403 });
        const form = await req.formData().catch(() => null);
        const key = form ? String(form.get("key") ?? "") : "";
        const check = adminKeyCheck(req, key);
        if (check !== "ok") return adminDenied(check);
        const slug = String(form!.get("slug") ?? "");
        const niche = await getNiche(slug);
        const niches = await listNiches({ limit: 500 });
        if (!niche) return html(adminListPage(niches, key), 404, { "Cache-Control": "no-store" });
        const token = newKeeperToken();
        await sql`UPDATE niches SET keeper_token_hash = ${hashToken(token)} WHERE id = ${niche.id}`;
        const url = `${baseUrl(req)}/keeper/${niche.slug}?token=${encodeURIComponent(token)}`;
        console.log(`Owner issued a new keeper link for ${niche.slug}`);
        return html(adminListPage(niches, key, { name: niche.name, url }, await reminderCounts(), await giftSales()), 200, { "Cache-Control": "no-store", "Referrer-Policy": "same-origin" });
      }),
    },

    "/keeper/:slug": safe(async (req) => {
      const token = new URL(req.url).searchParams.get("token");
      const niche = await verifyKeeper(req.params.slug, token);
      if (!niche) {
        const p = messagePage("This keeper link isn't valid", "Please check you copied the whole private link you were given when the niche was created.", 403);
        return html(p.html, p.status, { "Referrer-Policy": "same-origin" });
      }
      const [notes, photos, gifts] = await Promise.all([getNotes(niche.id, 500), getPhotos(niche.id), keeperGifts(niche.id)]);
      return html(keeperPage({ niche, notes, photos, gifts, token: token!, base: baseUrl(req) }), 200, {
        "Referrer-Policy": "same-origin",
        "Cache-Control": "no-store",
      });
    }),

    "/api/niches": { POST: safe(createNiche) },
    "/api/pet/:slug/candle": { POST: safe((req) => tribute(req, req.params.slug, "candle")) },
    "/api/pet/:slug/flower": { POST: safe((req) => tribute(req, req.params.slug, "flower")) },
    "/api/pet/:slug/notes": { POST: safe((req) => addNote(req, req.params.slug)) },
    "/api/pet/:slug/remind": { POST: safe((req) => remindMe(req, req.params.slug)) },
    "/api/pet/:slug/gift": { POST: safe((req) => startGift(req, req.params.slug)) },
    "/api/stripe/webhook": { POST: safe(stripeWebhook) },
    "/api/keeper/:slug/gift-hide": {
      POST: safe(async (req) => {
        const r = await keeperFromJson(req, req.params.slug);
        if (!r.ok) return r.error;
        const id = Number(r.data.giftId);
        if (!Number.isInteger(id)) return json({ error: "Unknown gift" }, 400);
        await setGiftHidden(r.niche.id, id, r.data.hidden === true);
        return json({ ok: true });
      }),
    },
    "/api/keeper/:slug/remove-note": { POST: safe((req) => keeperAction(req, req.params.slug, "remove-note")) },
    "/api/keeper/:slug/delete": { POST: safe((req) => keeperAction(req, req.params.slug, "delete")) },
    "/api/keeper/:slug/details": { POST: safe((req) => keeperDetails(req, req.params.slug)) },
    "/api/keeper/:slug/photos": { POST: safe((req) => keeperAddPhotos(req, req.params.slug)) },
    "/api/keeper/:slug/photo-portrait": { POST: safe((req) => keeperPhotoAction(req, req.params.slug, "portrait")) },
    "/api/keeper/:slug/photo-remove": { POST: safe((req) => keeperPhotoAction(req, req.params.slug, "remove")) },
    "/api/keeper/:slug/photo-move": { POST: safe((req) => keeperPhotoAction(req, req.params.slug, "move")) },
  },
  fetch() {
    return notFound();
  },
  error(err) {
    console.error(err);
    return new Response("Something went wrong", { status: 500 });
  },
});

console.log(`Starlight Garden listening on ${server.url}`);
