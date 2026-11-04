import type { Niche, Note, Photo } from "./db";
import { KINDS } from "./db";
import { ageYears, datesLine, esc, timeAgo, yearsLine } from "./util";

export const SITE_NAME = "Starlight Garden";
const ASSET_VERSION = (process.env.RAILWAY_GIT_COMMIT_SHA ?? String(Date.now())).slice(0, 8);

// ---------- icons (inline stroke SVG) ----------

const icon = {
  logo: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#E8B04B" stroke-width="1.5" aria-hidden="true"><path d="M12 2l1.8 4.6L18.5 8l-4.7 1.4L12 14l-1.8-4.6L5.5 8l4.7-1.4z"/><path d="M5 20c2-3 4.5-4 7-4s5 1 7 4"/></svg>`,
  paw: (size = 40) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><ellipse cx="12" cy="16" rx="4.5" ry="3.5"/><circle cx="6.5" cy="10.5" r="1.8"/><circle cx="10" cy="7" r="1.8"/><circle cx="14" cy="7" r="1.8"/><circle cx="17.5" cy="10.5" r="1.8"/></svg>`,
  candle: (size = 18) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 3c1.5 2 2 3 2 4a2 2 0 0 1-4 0c0-1 .5-2 2-4z"/><rect x="9" y="11" width="6" height="10" rx="1"/></svg>`,
  flower: (size = 20) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8" r="2.2"/><circle cx="12" cy="4" r="1.8"/><circle cx="15.6" cy="8" r="1.8"/><circle cx="8.4" cy="8" r="1.8"/><circle cx="12" cy="11.6" r="1.8"/><path d="M12 13.5V21M12 17c-1.8 0-3-1-3.6-2.4M12 18.5c1.8 0 3-1 3.6-2.4"/></svg>`,
  share: (size = 20) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 20l1.4-4A8 8 0 1 1 8.4 19z"/><path d="M12 8.5c.9 1.2 1.2 1.8 1.2 2.4a1.2 1.2 0 0 1-2.4 0c0-.6.3-1.2 1.2-2.4z"/><path d="M10.6 13.6h2.8v2.2h-2.8z"/></svg>`,
  upload: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>`,
};

const hills = `<svg class="hills" aria-hidden="true" viewBox="0 0 1440 180" preserveAspectRatio="none">
  <path d="M0 120 C120 80 220 110 320 90 C430 68 520 100 620 84 C760 60 860 104 980 86 C1100 68 1220 96 1320 80 C1380 72 1420 78 1440 82 L1440 180 L0 180 Z" fill="#3C5A47"/>
  <path d="M0 150 C160 120 300 146 460 128 C620 110 760 140 920 126 C1080 112 1240 140 1440 120 L1440 180 L0 180 Z" fill="#4E6E57"/>
  <path d="M0 172 C200 160 400 170 720 164 C1040 158 1240 168 1440 162 L1440 180 L0 180 Z" fill="#F4F1EA"/>
</svg>`;

// ---------- shared pieces ----------

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function photoUrl(key: string | null): string | null {
  return key ? `/photo/${key}` : null;
}

export function shareMessage(name: string, url: string, lit: boolean): string {
  const first = lit
    ? `I just lit a candle for ${name} at ${SITE_NAME}.`
    : `${name} has a little niche at ${SITE_NAME}.`;
  return `${first} If ${name} ever made you smile, come visit and send a little light too: ${url}`;
}

export function waLink(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

function nav(variant: "hero" | "compact" | "night") {
  return `<nav class="nav" aria-label="Main">
    <a class="brand" href="/">${icon.logo}<span>${SITE_NAME}</span></a>
    <div class="nav-links">
      <a href="/#wall">The Garden Wall</a>
      <a href="/sky">Night Sky</a>
      ${variant === "hero" ? `<a href="/#how">How it works</a>` : ""}
      <a class="btn btn-gold" href="/create">Create a niche</a>
    </div>
  </nav>`;
}

function footer() {
  return `<footer class="footer"><div class="wrap footer-row">
    <span class="footer-brand">${SITE_NAME}</span>
    <span>Every friend is remembered here.</span>
  </div></footer>`;
}

type LayoutOpts = {
  title: string;
  description?: string;
  url?: string;
  image?: string | null;
  header?: "hero" | "compact" | "night" | "none";
  heroHtml?: string;
  body: string;
  night?: boolean;
  noindex?: boolean;
};

export function layout(o: LayoutOpts): string {
  const description = o.description ?? "A quiet online garden to remember and visit the pets who walked beside us.";
  const header =
    o.header === "hero"
      ? `<header class="sky hero">${nav("hero")}${o.heroHtml ?? ""}${hills}</header>`
      : o.header === "none"
        ? ""
        : o.header === "night"
          ? `<header>${nav("night")}</header>`
          : `<header class="sky">${nav("compact")}</header>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(description)}">
${o.noindex ? `<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">` : ""}
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(description)}">
${o.url ? `<meta property="og:url" content="${esc(o.url)}">` : ""}
${o.image ? `<meta property="og:image" content="${esc(o.image)}"><meta name="twitter:card" content="summary_large_image">` : ""}
<meta name="theme-color" content="#1B2236">
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Marcellus&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/app.css?v=${ASSET_VERSION}">
<script src="/static/app.js?v=${ASSET_VERSION}" defer></script>
</head>
<body class="${o.night ? "night-page" : ""}">
<a class="skip" href="#main">Skip to content</a>
${header}
<main id="main">${o.body}</main>
${o.night ? "" : footer()}
</body>
</html>`;
}

function portraitBox(n: Pick<Niche, "name" | "portrait_key">, cls: string, size = 40) {
  const url = photoUrl(n.portrait_key);
  return url
    ? `<img class="${cls}" src="${esc(url)}" alt="Portrait of ${esc(n.name)}" loading="lazy" decoding="async">`
    : `<div class="${cls} placeholder">${icon.paw(size)}</div>`;
}

function plaqueCard(n: Niche) {
  const years = yearsLine(n.born, n.passed);
  return `<a class="plaque" href="/pet/${esc(n.slug)}">
    ${portraitBox(n, "plaque-photo")}
    <div class="plaque-body">
      <span class="plaque-name">${esc(n.name)}</span>
      <span class="plaque-meta">${esc(n.kind)}${years ? ` · ${esc(years)}` : ""}</span>
      <span class="plaque-candles">${icon.candle(16)} ${plural(n.candles, "candle", "candles")} lit</span>
    </div>
  </a>`;
}

// ---------- pages ----------

export function homePage(opts: { niches: Niche[]; q: string; kind: string; total: number; base: string }) {
  const { niches, q, kind, total } = opts;
  const filters = [
    ["all", "All"],
    ["dogs", "Dogs"],
    ["cats", "Cats"],
    ["small", "Small pets"],
  ]
    .map(([k, label]) => {
      const params = new URLSearchParams();
      if (k !== "all") params.set("kind", k);
      if (q) params.set("q", q);
      const href = `/${params.size ? `?${params}` : ""}#wall`;
      return `<a class="pill${kind === k ? " is-on" : ""}" href="${esc(href)}"${kind === k ? ` aria-current="page"` : ""}>${label}</a>`;
    })
    .join("");

  let wallInner: string;
  if (niches.length) {
    wallInner = `<div class="wall-grid">${niches.map(plaqueCard).join("")}</div>`;
  } else if (total === 0) {
    wallInner = `<div class="empty">
      <p class="empty-title">The garden wall is waiting for its first friend.</p>
      <p>Create a niche and fill it with their photos and your words.</p>
      <a class="btn btn-dark" href="/create">Create the first niche</a>
    </div>`;
  } else {
    wallInner = `<div class="empty">
      <p class="empty-title">No niche found${q ? ` for “${esc(q)}”` : ""}.</p>
      <p>Check the spelling, or <a href="/#wall">see every friend on the wall</a>.</p>
    </div>`;
  }

  const heroHtml = `
    <div class="moon" aria-hidden="true"></div>
    <div class="wrap hero-inner">
      <p class="kicker">An online pet columbarium</p>
      <h1>A quiet garden to visit the friends who walked beside us</h1>
      <p class="lede">Give your pet a niche on the garden wall. Fill it with their photos and your words, and come back to sit with them whenever you need to.</p>
      <form class="find" action="/" method="get" role="search">
        <div class="find-field">
          <label for="find">Visit a friend</label>
          <input id="find" name="q" type="search" placeholder="Search by your pet's name" value="${esc(q)}" maxlength="60">
        </div>
        <button class="btn btn-ghost" type="submit">Find their niche</button>
      </form>
    </div>`;

  const body = `
  <section id="wall" class="wrap section">
    <div class="section-head">
      <div>
        <h2>${q ? `Results for “${esc(q)}”` : "The Garden Wall"}</h2>
        <p class="muted">Each niche holds one beloved friend. Step closer to visit.</p>
      </div>
      <div class="pills" role="group" aria-label="Filter by kind of pet">${filters}</div>
    </div>
    <div class="wall">${wallInner}</div>
  </section>
  <section id="how" class="wrap section">
    <h2 class="center">How it works</h2>
    <div class="steps">
      <div class="step"><span class="step-num">1</span><h3>Create their niche</h3><p>Add their name, the years you shared, and a few words about who they were.</p></div>
      <div class="step"><span class="step-num">2</span><h3>Upload their photos</h3><p>Choose a portrait for the wall, then add the everyday pictures you treasure.</p></div>
      <div class="step"><span class="step-num">3</span><h3>Visit whenever you like</h3><p>Light a candle, leave flowers or a note, and send a little light to the people who loved them too.</p></div>
    </div>
  </section>`;

  return layout({
    title: `${SITE_NAME} — an online pet columbarium`,
    url: `${opts.base}/`,
    image: `${opts.base}/static/og.png`,
    header: "hero",
    heroHtml,
    body,
  });
}

export function nichePage(opts: { niche: Niche; photos: Photo[]; notes: Note[]; base: string }) {
  const { niche: n, photos, notes, base } = opts;
  const url = `${base}/pet/${n.slug}`;
  const age = ageYears(n.born, n.passed);
  const kicker = [n.kind, age !== null ? `${age} ${age === 1 ? "year" : "years"}` : ""].filter(Boolean).join(" · ");
  const dates = datesLine(n.born, n.passed);
  const story = (n.story ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const msg = shareMessage(n.name, url, false);
  const litMsg = shareMessage(n.name, url, true);
  const image = n.portrait_key ? `${base}/photo/${n.portrait_key}` : `${base}/static/og.png`;
  const flames = Math.min(n.candles, 24);

  const gallery = photos.length
    ? `<section class="section-tight" aria-labelledby="gallery-h">
        <h2 id="gallery-h">Moments with ${esc(n.name)}</h2>
        <div class="gallery">
          ${photos
            .map(
              (p, i) =>
                `<a class="gallery-item" href="/photo/${esc(p.key)}" data-lightbox>
                  <img src="/photo/${esc(p.key)}" alt="Photo ${i + 1} of ${esc(n.name)}" loading="lazy" decoding="async">
                </a>`,
            )
            .join("")}
        </div>
      </section>`
    : "";

  const notesHtml = notes.length
    ? notes.map((note) => noteItem(note)).join("")
    : `<li class="note-empty">No notes yet. Be the first to leave a few kind words.</li>`;

  const body = `
  <div class="wrap niche"
       data-niche="${esc(n.slug)}"
       data-name="${esc(n.name)}"
       data-share-default="${esc(msg)}"
       data-share-lit="${esc(litMsg)}">
    <section class="niche-hero">
      <div class="alcove">
        ${portraitBox(n, "alcove-photo", 56)}
        <div class="alcove-plate">
          <span class="alcove-name">${esc(n.name)}</span>
          ${dates ? `<span class="alcove-dates">${esc(dates)}</span>` : ""}
        </div>
      </div>
      <div class="niche-text">
        ${kicker ? `<p class="kicker sage">${esc(kicker)}</p>` : ""}
        <h1>${n.plaque_line ? `“${esc(n.plaque_line)}”` : `In loving memory of ${esc(n.name)}`}</h1>
        ${story ? `<div class="story">${story}</div>` : ""}
        ${n.keeper_name ? `<p class="muted">Niche kept by ${esc(n.keeper_name)} · Visitors welcome</p>` : `<p class="muted">Visitors welcome</p>`}
        <div class="actions">
          <a class="btn btn-dark" href="#tributes">Leave a tribute</a>
          <a class="btn btn-outline" href="/sky?pet=${esc(n.slug)}">See ${esc(n.name)}'s star</a>
          <a class="btn btn-wa" data-share href="${esc(waLink(msg))}" target="_blank" rel="noopener" aria-label="Send a Light: share ${esc(n.name)}'s niche on WhatsApp">${icon.share()} Send a Light</a>
        </div>
      </div>
    </section>

    ${gallery}

    <section id="tributes" class="tributes" aria-labelledby="trib-h">
      <div class="tributes-head">
        <div>
          <h2 id="trib-h">Tributes</h2>
          <p class="muted"><span data-count="candles" data-one="candle lit" data-many="candles lit">${plural(n.candles, "candle lit", "candles lit")}</span> · <span data-count="flowers" data-one="bunch of flowers" data-many="bunches of flowers">${plural(n.flowers, "bunch of flowers", "bunches of flowers")}</span> · <span data-count="notes" data-one="note" data-many="notes">${plural(notes.length, "note", "notes")}</span></p>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-tribute" data-tribute="candle" aria-pressed="false">${icon.candle(20)} <span>Light a candle</span></button>
          <button type="button" class="btn btn-tribute" data-tribute="flower" aria-pressed="false">${icon.flower()} <span>Leave flowers</span></button>
        </div>
      </div>

      <div class="flames" aria-hidden="true" data-flames>
        ${"<span class=\"flame\"></span>".repeat(flames)}
        <span class="flames-text">${n.candles ? `glowing for ${esc(n.name)} tonight` : `Be the first to light a candle for ${esc(n.name)}`}</span>
      </div>

      <div class="light-panel">
        <div class="light-text">
          <span class="light-title">Send a Light</span>
          <span data-share-hint>Invite the people who loved ${esc(n.name)} to visit and light a candle with you.</span>
          <span class="light-msg">“<span data-share-text>${esc(msg)}</span>”</span>
        </div>
        <a class="btn btn-wa btn-lg" data-share href="${esc(waLink(msg))}" target="_blank" rel="noopener" aria-label="Send a Light: share ${esc(n.name)}'s niche on WhatsApp">${icon.share(22)} Send a Light on WhatsApp</a>
      </div>

      <form class="note-form" data-note-form>
        <label for="note">Write a note to ${esc(n.name)}</label>
        <textarea id="note" name="body" rows="3" maxlength="600" required placeholder="Share a memory or a few kind words"></textarea>
        <div class="note-row">
          <div class="field-inline">
            <label for="author">Your name <span class="optional">(optional)</span></label>
            <input id="author" name="author" type="text" maxlength="60" autocomplete="name">
          </div>
          <button class="btn btn-sage" type="submit">Leave note</button>
        </div>
        <p class="form-status" role="status" data-note-status></p>
        <p class="muted small">Notes appear right away. The niche keeper can remove any note.</p>
      </form>

      <ul class="notes" data-notes>${notesHtml}</ul>
    </section>
  </div>
  <dialog class="lightbox" data-lightbox-dialog aria-label="Photo">
    <img alt="">
    <button type="button" class="btn btn-ghost lightbox-close" data-close>Close</button>
  </dialog>`;

  return layout({
    title: `Light a candle for ${n.name} · ${SITE_NAME}`,
    description: n.plaque_line
      ? `“${n.plaque_line}” — visit ${n.name}'s niche and send a little light.`
      : `Visit ${n.name}'s niche at ${SITE_NAME} and send a little light.`,
    url,
    image,
    header: "compact",
    body,
  });
}

export function noteItem(note: Note) {
  return `<li class="note">
    <p>${esc(note.body).replace(/\n/g, "<br>")}</p>
    <span class="muted small">${esc(note.author || "A visitor")} · ${esc(timeAgo(new Date(note.created_at)))}</span>
  </li>`;
}

export function createPage(base: string) {
  const today = new Date().toISOString().slice(0, 10);
  const kinds = KINDS.map((k) => `<option${k === "Dog" ? " selected" : ""}>${k}</option>`).join("");
  const body = `
  <div class="wrap section">
    <h1 class="page-title">Create a niche</h1>
    <p class="muted lede-dark">Take your time. Everything here can be written gently, at your own pace.</p>

    <div class="create" data-create>
      <form class="card create-form" data-create-form novalidate>
        <fieldset>
          <legend>About them</legend>
          <div class="grid-2">
            <div class="field"><label for="name">Their name</label><input id="name" name="name" type="text" maxlength="60" required autocomplete="off"></div>
            <div class="field"><label for="kind">They were a</label><select id="kind" name="kind">${kinds}</select></div>
            <div class="field"><label for="born">Born or welcomed home <span class="optional">(optional)</span></label><input id="born" name="born" type="date" max="${today}"></div>
            <div class="field"><label for="passed">Passed away <span class="optional">(optional)</span></label><input id="passed" name="passed" type="date" max="${today}"></div>
          </div>
          <div class="field"><label for="plaque_line">A line for their plaque <span class="optional">(optional)</span></label><input id="plaque_line" name="plaque_line" type="text" maxlength="80" placeholder="Forever curled up in a sunbeam"></div>
          <div class="field"><label for="story">Their story <span class="optional">(optional)</span></label><textarea id="story" name="story" rows="6" maxlength="4000" placeholder="What made them who they were: their habits, the places they loved, what you miss most."></textarea></div>
          <div class="field"><label for="keeper_name">Kept by <span class="optional">(optional, shown on the niche)</span></label><input id="keeper_name" name="keeper_name" type="text" maxlength="60" placeholder="e.g. The Tan family"></div>
        </fieldset>

        <fieldset>
          <legend>Their photos</legend>
          <label class="dropzone" for="photos" data-dropzone>
            ${icon.upload}
            <span class="dz-title">Drop photos here or choose from your device</span>
            <span class="dz-sub">JPG, PNG, WEBP or HEIC · up to 12 photos</span>
            <input id="photos" name="photos" type="file" accept="image/*" multiple class="visually-hidden">
          </label>
          <div class="thumbs" data-thumbs></div>
          <p class="muted small" data-thumbs-hint hidden>The photo with the gold border becomes their portrait on the Garden Wall. Tap another photo to choose it instead, or remove one with ×.</p>
        </fieldset>

        <p class="form-status" role="status" aria-live="polite" data-create-status></p>
        <div class="form-actions">
          <a class="btn btn-outline" href="/">Cancel</a>
          <button class="btn btn-dark" type="submit" data-create-submit>Place on the Garden Wall</button>
        </div>
      </form>

      <aside class="preview" aria-label="Preview of the plaque">
        <span class="kicker sage">Preview on the wall</span>
        <div class="alcove alcove-sm">
          <div class="alcove-photo placeholder" data-preview-photo>${icon.paw(48)}</div>
          <div class="alcove-plate">
            <span class="alcove-name" data-preview-name>Their name</span>
            <span class="alcove-dates" data-preview-meta>Dog</span>
            <span class="alcove-line" data-preview-line></span>
          </div>
        </div>
      </aside>
    </div>

    <div class="card done" data-done hidden>
      <h2 data-done-title>Their niche is ready</h2>
      <p>Your friend now has a place on the Garden Wall. Visit anytime, and send a little light to the people who loved them.</p>
      <div class="keeper-box">
        <p><strong>Save your private keeper link.</strong> It's the only way to manage this niche later (remove notes or take the niche down). Anyone with this link can manage it, so keep it to yourself.</p>
        <div class="copy-row">
          <input type="text" readonly data-keeper-url aria-label="Your private keeper link">
          <button type="button" class="btn btn-outline" data-copy>Copy link</button>
        </div>
      </div>
      <div class="actions">
        <a class="btn btn-dark" data-done-visit href="/">Visit their niche</a>
        <a class="btn btn-wa" data-done-share href="#" target="_blank" rel="noopener">${icon.share()} Send a Light</a>
      </div>
    </div>
  </div>`;
  return layout({ title: `Create a niche · ${SITE_NAME}`, url: `${base}/create`, image: `${base}/static/og.png`, header: "compact", body });
}

function starPosition(id: number) {
  // deterministic scatter
  const a = Math.sin(id * 12.9898) * 43758.5453;
  const b = Math.sin(id * 78.233) * 12345.6789;
  const x = 12 + (a - Math.floor(a)) * 76;
  const y = 8 + (b - Math.floor(b)) * 62;
  return { x: x.toFixed(2), y: y.toFixed(2) };
}

export function skyPage(opts: { niches: Niche[]; selected?: string; base: string }) {
  const { niches } = opts;
  const sel = niches.find((n) => n.slug === opts.selected) ?? niches[0];
  const stars = niches
    .map((n) => {
      const { x, y } = starPosition(n.id);
      const size = Math.round(6 + Math.min(n.candles, 90) / 9);
      const on = sel && n.slug === sel.slug;
      return `<button type="button" class="star${on ? " is-on" : ""}" style="left:${x}%;top:${y}%;--s:${size}px"
        aria-pressed="${on ? "true" : "false"}" aria-label="${esc(n.name)}, ${plural(n.candles, "candle", "candles")} lit"
        data-star data-slug="${esc(n.slug)}" data-name="${esc(n.name)}" data-kind="${esc(n.kind)}"
        data-years="${esc(yearsLine(n.born, n.passed))}" data-candles="${n.candles}"
        data-photo="${esc(photoUrl(n.portrait_key) ?? "")}">
        <span class="star-dot" aria-hidden="true"></span><span class="star-name">${esc(n.name)}</span>
      </button>`;
    })
    .join("");

  const card = sel
    ? `<section class="sky-card" aria-live="polite" data-sky-card>
        <div class="sky-photo" data-sky-photo>${sel.portrait_key ? `<img src="${esc(photoUrl(sel.portrait_key)!)}" alt="">` : icon.paw(36)}</div>
        <div class="sky-info">
          <span class="sky-name" data-sky-name>${esc(sel.name)}</span>
          <span class="sky-meta" data-sky-meta>${esc([sel.kind, yearsLine(sel.born, sel.passed), `${plural(sel.candles, "candle", "candles")} lit`].filter(Boolean).join(" · "))}</span>
          <a class="sky-link" data-sky-link href="/pet/${esc(sel.slug)}">Visit ${esc(sel.name)}'s niche</a>
        </div>
      </section>`
    : `<section class="sky-card"><div class="sky-info"><span class="sky-name">The sky is still waiting for its first star.</span><a class="sky-link" href="/create">Create a niche</a></div></section>`;

  const body = `
  <div class="wrap sky-wrap">
    <div class="sky-head">
      <h1>The Remembrance Sky</h1>
      <p>After dark, every friend on the Garden Wall becomes a star. The more candles lit for them, the brighter they shine. Tap a star to say hello.</p>
    </div>
    <div class="sky-field">
      ${stars}
      <svg class="sky-hills" aria-hidden="true" viewBox="0 0 1200 120" preserveAspectRatio="none">
        <path d="M0 70 C150 40 300 80 460 56 C620 34 760 74 920 54 C1060 38 1140 60 1200 52 L1200 120 L0 120 Z" fill="#1E2B26"/>
        <path d="M0 96 C200 76 420 100 640 86 C860 72 1040 98 1200 84 L1200 120 L0 120 Z" fill="#263830"/>
      </svg>
    </div>
    ${card}
  </div>`;
  return layout({
    title: `The Remembrance Sky · ${SITE_NAME}`,
    description: "Every friend on the Garden Wall becomes a star. Tap a star to say hello.",
    url: `${opts.base}/sky`,
    image: `${opts.base}/static/og.png`,
    header: "night",
    night: true,
    body,
  });
}

export function keeperPage(opts: { niche: Niche; notes: Note[]; token: string; base: string }) {
  const { niche: n, notes, token, base } = opts;
  const url = `${base}/pet/${n.slug}`;
  const rows = notes.length
    ? notes
        .map(
          (note) => `<li class="note" data-note-id="${note.id}">
            <p>${esc(note.body).replace(/\n/g, "<br>")}</p>
            <div class="note-row">
              <span class="muted small">${esc(note.author || "A visitor")} · ${esc(timeAgo(new Date(note.created_at)))}</span>
              <button type="button" class="btn btn-outline btn-sm" data-remove-note="${note.id}">Remove</button>
            </div>
          </li>`,
        )
        .join("")
    : `<li class="note-empty">No notes yet.</li>`;
  const body = `
  <div class="wrap section keeper" data-keeper data-slug="${esc(n.slug)}" data-token="${esc(token)}">
    <p class="kicker sage">Keeper's corner · private</p>
    <h1 class="page-title">Caring for ${esc(n.name)}'s niche</h1>
    <p class="muted lede-dark">Only people with this private link can see this page. Keep it safe.</p>
    <div class="card keeper-summary">
      ${portraitBox(n, "keeper-photo", 36)}
      <div>
        <p><strong>${esc(n.name)}</strong> · ${plural(n.candles, "candle", "candles")} · ${plural(n.flowers, "bunch of flowers", "bunches of flowers")} · ${plural(notes.length, "note", "notes")}</p>
        <div class="actions">
          <a class="btn btn-dark" href="/pet/${esc(n.slug)}">View the niche</a>
          <a class="btn btn-wa" href="${esc(waLink(shareMessage(n.name, url, false)))}" target="_blank" rel="noopener">${icon.share()} Send a Light</a>
        </div>
      </div>
    </div>
    <section class="section-tight">
      <h2>Notes from visitors</h2>
      <ul class="notes">${rows}</ul>
    </section>
    <section class="section-tight danger">
      <h2>Take the niche down</h2>
      <p class="muted">This permanently removes ${esc(n.name)}'s niche, photos, candles and notes. It can't be undone.</p>
      <button type="button" class="btn btn-danger" data-delete-niche>Remove this niche</button>
      <p class="form-status" role="status" data-keeper-status></p>
    </section>
  </div>`;
  return layout({ title: `Keeper · ${n.name} · ${SITE_NAME}`, header: "compact", body, noindex: true });
}

export function messagePage(title: string, text: string, status = 404) {
  return {
    status,
    html: layout({
      title: `${title} · ${SITE_NAME}`,
      header: "compact",
      noindex: true,
      body: `<div class="wrap section center message"><h1 class="page-title">${esc(title)}</h1><p class="muted">${esc(text)}</p><a class="btn btn-dark" href="/">Return to the garden</a></div>`,
    }),
  };
}
