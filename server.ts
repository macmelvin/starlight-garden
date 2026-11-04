import { join } from "node:path";
import { analyticsOrigins } from "./src/analytics";
import { KINDS, countNiches, getNiche, getNotes, getPhotos, listNiches, listPortraits, migrate, sql } from "./src/db";
import { KEY_PATTERN, deletePhotos, getThumb, photoFile, putPhoto, s3, storageConfigured } from "./src/storage";
import {
  allow, clientIp, hashToken, petFirstName, isIsoDate, newKeeperToken, randomId, safeEqual, slugify, sniffImage, TYPE_BY_EXT,
} from "./src/util";
import { createPage, homePage, keeperPage, messagePage, nichePage, noteItem, reminderIcs, skyPage } from "./src/views";

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

async function verifyKeeper(slug: string, token: unknown) {
  if (typeof token !== "string" || token.length < 10) return null;
  const niche = await getNiche(slug);
  if (!niche) return null;
  return safeEqual(hashToken(token), niche.keeper_token_hash) ? niche : null;
}

// ---------- handlers ----------

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

  const name = petFirstName(text(form, "name", 60));
  const kindRaw = text(form, "kind", 30);
  const kind = (KINDS as readonly string[]).includes(kindRaw) ? kindRaw : "Other friend";
  const born = text(form, "born", 10) || null;
  const passed = text(form, "passed", 10) || null;
  const plaqueLine = text(form, "plaque_line", 80) || null;
  const story = text(form, "story", 4000) || null;
  const keeperName = text(form, "keeper_name", 60) || null;
  const portraitIndex = Math.max(0, Number(text(form, "portrait", 3)) || 0);

  if (!name) return json({ error: "Please add their name." }, 400);
  const today = new Date().toISOString().slice(0, 10);
  for (const [label, d] of [["birth", born], ["passing", passed]] as const) {
    if (d && (!isIsoDate(d) || d > today)) return json({ error: `Please check the ${label} date.` }, 400);
  }
  if (born && passed && born > passed) return json({ error: "The birth date should come before the date they passed." }, 400);

  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return json({ error: "Please add at least one photo." }, 400);
  if (files.length > MAX_PHOTOS) return json({ error: `Please choose up to ${MAX_PHOTOS} photos.` }, 400);

  const checked: { file: File; ext: string; type: string }[] = [];
  for (const file of files) {
    if (file.size > MAX_PHOTO_BYTES) return json({ error: "One of the photos is too large (15 MB max)." }, 400);
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const kindOf = sniffImage(head);
    if (!kindOf) return json({ error: "One of the files isn't a supported photo (JPG, PNG, WEBP, GIF or HEIC)." }, 400);
    checked.push({ file, ...kindOf });
  }

  const slug = slugify(name);
  const uploaded: string[] = [];
  try {
    for (const c of checked) {
      const key = `niches/${slug}/${randomId(12)}.${c.ext}`;
      await putPhoto(key, c.file, c.type);
      uploaded.push(key);
    }
  } catch (err) {
    console.error("upload failed", err);
    await deletePhotos(uploaded);
    return json({ error: "We couldn't save the photos. Please try again." }, 502);
  }

  const portraitKey = uploaded[Math.min(portraitIndex, uploaded.length - 1)];
  const token = newKeeperToken();
  try {
    await sql.begin(async (tx) => {
      const [row] = await tx`
        INSERT INTO niches (slug, name, kind, born, passed, plaque_line, story, keeper_name, keeper_token_hash, portrait_key)
        VALUES (${slug}, ${name}, ${kind}, ${born}::date, ${passed}::date, ${plaqueLine}, ${story}, ${keeperName}, ${hashToken(token)}, ${portraitKey})
        RETURNING id`;
      // portrait first, then the rest in the order chosen
      const ordered = [portraitKey, ...uploaded.filter((k) => k !== portraitKey)];
      for (let i = 0; i < ordered.length; i++) {
        await tx`INSERT INTO photos (niche_id, key, position) VALUES (${row.id}, ${ordered[i]}, ${i})`;
      }
    });
  } catch (err) {
    console.error("db insert failed", err);
    await deletePhotos(uploaded);
    return json({ error: "We couldn't create the niche. Please try again." }, 500);
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
  await deletePhotos(photos.map((p) => p.key));
  return json({ ok: true });
}

async function servePhoto(req: Request) {
  const key = decodeURIComponent(new URL(req.url).pathname.replace(/^\/photo\//, ""));
  if (!KEY_PATTERN.test(key)) return new Response("Not found", { status: 404 });
  const file = photoFile(key);
  try {
    const ext = key.split(".").pop()!;
    // stream rather than redirect so link previews (WhatsApp) can read it
    const stat = await file.stat();
    return new Response(file.stream(), {
      headers: {
        "Content-Type": TYPE_BY_EXT[ext] ?? "application/octet-stream",
        "Content-Length": String(stat.size),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
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
  maxRequestBodySize: MAX_PHOTOS * MAX_PHOTO_BYTES + 1024 * 1024,
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
      const [photos, notes] = await Promise.all([getPhotos(niche.id), getNotes(niche.id)]);
      return html(nichePage({ niche, photos, notes, base: baseUrl(req) }));
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

    "/keeper/:slug": safe(async (req) => {
      const token = new URL(req.url).searchParams.get("token");
      const niche = await verifyKeeper(req.params.slug, token);
      if (!niche) {
        const p = messagePage("This keeper link isn't valid", "Please check you copied the whole private link you were given when the niche was created.", 403);
        return html(p.html, p.status, { "Referrer-Policy": "no-referrer" });
      }
      const notes = await getNotes(niche.id, 500);
      return html(keeperPage({ niche, notes, token: token!, base: baseUrl(req) }), 200, {
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
      });
    }),

    "/api/niches": { POST: safe(createNiche) },
    "/api/pet/:slug/candle": { POST: safe((req) => tribute(req, req.params.slug, "candle")) },
    "/api/pet/:slug/flower": { POST: safe((req) => tribute(req, req.params.slug, "flower")) },
    "/api/pet/:slug/notes": { POST: safe((req) => addNote(req, req.params.slug)) },
    "/api/keeper/:slug/remove-note": { POST: safe((req) => keeperAction(req, req.params.slug, "remove-note")) },
    "/api/keeper/:slug/delete": { POST: safe((req) => keeperAction(req, req.params.slug, "delete")) },
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
