import type { Niche, Note, Photo } from "./db";
import { KINDS, consentText } from "./db";
import type { GiftRow } from "./db";
import { GIFTS, getGift, giftArt, price, stripeTestMode } from "./gifts";
import type { GiftId } from "./gifts";
import { analyticsTag } from "./analytics";
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
  card: (size = 20) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 6.5l.9 2.2 2.3.7-2.3.7-.9 2.2-.9-2.2-2.3-.7 2.3-.7z"/><path d="M9 17.5h6"/></svg>`,
  calendar: (size = 18) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`,
  play: `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>`,
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

function clock(seconds: number | null): string {
  if (!seconds) return "";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function thumbUrl(key: string | null): string | null {
  return key ? `/thumb/${key}` : null;
}

/** Faded mosaic of every pet's portrait, repeated to fill the hero. */
function heroCollage(portraits: { name: string; portrait_key: string }[]): string {
  if (!portraits.length) return "";
  const TILES = 60;
  const tiles: string[] = [];
  for (let i = 0; i < TILES; i++) {
    const p = portraits[i % portraits.length];
    tiles.push(`<img src="${esc(thumbUrl(p.portrait_key)!)}" alt="" decoding="async"${i > 23 ? ' loading="lazy"' : ""}>`);
  }
  return `<div class="hero-collage" aria-hidden="true">${tiles.join("")}</div><div class="hero-veil" aria-hidden="true"></div>`;
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
      <a class="btn btn-gold" href="/create" data-umami-event="Create niche click" data-umami-event-from="nav">Create a niche</a>
    </div>
  </nav>`;
}

function footer() {
  return `<footer class="footer"><div class="wrap footer-row">
    <span class="footer-brand">${SITE_NAME}</span>
    <span>Every friend is remembered here. · <a href="/privacy" class="footer-link">Privacy</a></span>
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
${o.noindex ? `<meta name="robots" content="noindex"><meta name="referrer" content="same-origin">` : ""}
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
${o.noindex ? "" : analyticsTag()}
</head>
<body class="${o.night ? "night-page" : ""}">
<a class="skip" href="#main">Skip to content</a>
${header}
<main id="main">${o.body}</main>
${o.night ? "" : footer()}
</body>
</html>`;
}

function portraitBox(n: Pick<Niche, "name" | "portrait_key">, cls: string, size = 40, thumb = false) {
  const url = thumb ? thumbUrl(n.portrait_key) : photoUrl(n.portrait_key);
  return url
    ? `<img class="${cls}" src="${esc(url)}" alt="Portrait of ${esc(n.name)}" loading="lazy" decoding="async">`
    : `<div class="${cls} placeholder">${icon.paw(size)}</div>`;
}

function plaqueCard(n: Niche) {
  const years = yearsLine(n.born, n.passed);
  return `<a class="plaque" href="/pet/${esc(n.slug)}">
    ${portraitBox(n, "plaque-photo", 40, true)}
    <div class="plaque-body">
      <span class="plaque-name">${esc(n.name)}</span>
      <span class="plaque-meta">${esc(n.kind)}${years ? ` · ${esc(years)}` : ""}</span>
      <span class="plaque-candles">${icon.candle(16)} ${plural(n.candles, "candle", "candles")} lit</span>
    </div>
  </a>`;
}


// ---------- anniversaries ----------

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function todaySG(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date());
}

function dayMonth(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1]}`;
}

/** A gentle line for the niche page on the anniversary of the day they passed. */
export function anniversaryToday(n: Pick<Niche, "name" | "born" | "passed">, today = todaySG()): string | null {
  const md = today.slice(5);
  const year = Number(today.slice(0, 4));
  if (n.passed && n.passed.slice(5) === md) {
    const yrs = year - Number(n.passed.slice(0, 4));
    if (yrs > 0) return `Remembering ${n.name}, ${yrs === 1 ? "one year" : `${yrs} years`} since they crossed to the stars.`;
  }
  return null;
}

export type ReminderKind = "birthday" | "passing";

export function reminderEvents(n: Pick<Niche, "name" | "born" | "passed">) {
  const out: { kind: ReminderKind; date: string; label: string; title: string }[] = [];
  if (n.passed) out.push({ kind: "passing", date: n.passed, label: `Remembering ${n.name} · ${dayMonth(n.passed)}`, title: `Remembering ${n.name}` });
  return out;
}

function reminderDetails(name: string, url: string, kind: ReminderKind): string {
  return kind === "birthday"
    ? `Celebrating ${name} today. Visit their niche and light a candle: ${url}`
    : `A day to remember ${name}. Visit their niche and light a candle: ${url}`;
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function googleCalendarLink(name: string, url: string, ev: { kind: ReminderKind; date: string; title: string }): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${ev.date.replace(/-/g, "")}/${nextDay(ev.date).replace(/-/g, "")}`,
    recur: "RRULE:FREQ=YEARLY",
    details: reminderDetails(name, url, ev.kind),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function icsEscape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function icsFold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 74) return line;
  const parts: string[] = [];
  let cur = "";
  let curLen = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    if (curLen + len > 73) {
      parts.push(cur);
      cur = "";
      curLen = 0;
    }
    cur += ch;
    curLen += len;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

export function reminderIcs(n: Pick<Niche, "name" | "born" | "passed" | "slug">, url: string, only?: ReminderKind): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const events = reminderEvents(n).filter((e) => !only || e.kind === only);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Starlight Garden//Reminders//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const ev of events) {
    const details = reminderDetails(n.name, url, ev.kind);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${n.slug}-${ev.kind}@starlight-garden`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ev.date.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${nextDay(ev.date).replace(/-/g, "")}`,
      "RRULE:FREQ=YEARLY",
      `SUMMARY:${icsEscape(ev.title)}`,
      `DESCRIPTION:${icsEscape(details)}`,
      `URL:${url}`,
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsEscape(ev.title)}`,
      "TRIGGER:PT9H",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

function rememberSection(n: Niche, url: string): string {
  const events = reminderEvents(n);
  if (!events.length) return "";
  const rows = events
    .map(
      (ev) => `<li class="remember-row">
        <span class="remember-label">${icon.calendar()} ${esc(ev.label)}</span>
        <span class="remember-actions">
          <a class="btn btn-outline btn-sm" href="${esc(googleCalendarLink(n.name, url, ev))}" target="_blank" rel="noopener" data-umami-event="Calendar reminder" data-umami-event-type="${ev.kind}" data-umami-event-app="google">Google Calendar</a>
          <a class="btn btn-outline btn-sm" href="/pet/${esc(n.slug)}/remember.ics?event=${ev.kind}" data-umami-event="Calendar reminder" data-umami-event-type="${ev.kind}" data-umami-event-app="ics">Apple &amp; others</a>
        </span>
      </li>`,
    )
    .join("");
  return `<section id="remember" class="remember" aria-labelledby="remember-h">
      <h2 id="remember-h">Remember ${esc(n.name)} every year</h2>
      <p class="muted">Add a gentle yearly reminder to your phone's calendar on the day ${esc(n.name)} passed, so you can come back and light a candle.</p>
      <ul class="remember-list">${rows}</ul>
      <form class="remind-form" data-remind-form>
        <h3>Or get an email reminder</h3>
        <div class="remind-row">
          <div class="field-inline">
            <label for="remind-email">Your email</label>
            <input id="remind-email" name="email" type="email" autocomplete="email" inputmode="email" required>
          </div>
        </div>
        <label class="consent"><input type="checkbox" name="consent" required> <span>${esc(consentText(n.name))}</span></label>
        <div><button class="btn btn-sage" type="submit">Remind me</button></div>
        <p class="muted small">Your email is never shown on the site. <a href="/privacy">Privacy</a></p>
        <p class="form-status" role="status" aria-live="polite" data-remind-status></p>
      </form>
    </section>`;
}

// ---------- pages ----------

export function homePage(opts: {
  niches: Niche[];
  q: string;
  kind: string;
  total: number;
  portraits: { name: string; portrait_key: string }[];
  base: string;
}) {
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
      <a class="btn btn-dark" href="/create" data-umami-event="Create niche click" data-umami-event-from="empty wall">Create the first niche</a>
    </div>`;
  } else {
    wallInner = `<div class="empty">
      <p class="empty-title">No niche found${q ? ` for “${esc(q)}”` : ""}.</p>
      <p>Check the spelling, or <a href="/#wall">see every friend on the wall</a>.</p>
    </div>`;
  }

  const heroHtml = `
    ${heroCollage(opts.portraits)}
    <div class="moon" aria-hidden="true"></div>
    <div class="wrap hero-inner">
      <p class="kicker">An online pet columbarium</p>
      <h1>A quiet starlit garden to visit our furkids who walked beside us</h1>
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

function shortDate(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Singapore" }).format(d);
}

function giftShelf(n: Niche, gifts: GiftRow[], shopOpen: boolean): string {
  if (!gifts.length && !shopOpen) return "";
  const items = gifts
    .map((g) => {
      const info = getGift(g.gift);
      if (!info) return "";
      return `<li class="gift-item${g.expires_at ? "" : " is-eternal"}">
        <span class="gift-art">${giftArt(info.id)}</span>
        <span class="gift-name">${esc(info.name)}</span>
        ${g.from_name ? `<span class="gift-from">from ${esc(g.from_name)}</span>` : ""}
        ${g.message ? `<span class="gift-msg">“${esc(g.message)}”</span>` : ""}
        <span class="gift-until">${g.expires_at ? `until ${esc(shortDate(new Date(g.expires_at)))}` : "forever"}</span>
      </li>`;
    })
    .join("");
  return `<section id="gifts" class="gifts" aria-labelledby="gifts-h">
      <div class="gifts-head">
        <div>
          <h2 id="gifts-h">${esc(n.name)}'s Karma</h2>
          <p class="muted">${gifts.length ? `${gifts.length} ${gifts.length === 1 ? "offering" : "offerings"} of love from family and friends, adding to ${esc(n.name)}'s karma.` : `Every offering at ${esc(n.name)}'s niche adds to their karma.`}</p>
        </div>
        ${shopOpen ? `<button type="button" class="btn btn-gold" data-open-gifts>Build ${esc(n.name)}'s Karma</button>` : ""}
      </div>
      ${gifts.length ? `<ul class="gift-shelf">${items}</ul>` : ""}
    </section>`;
}

function giftDialog(n: Niche): string {
  const options = GIFTS.map(
    (g, i) => `<label class="gift-option">
        <input type="radio" name="gift" value="${g.id}"${i === 1 ? " checked" : ""} data-price="${esc(price(g.cents))}">
        <span class="gift-card">
          <span class="gift-art">${giftArt(g.id as GiftId)}</span>
          <span class="gift-name">${esc(g.name)}</span>
          <span class="gift-price">${esc(price(g.cents))}</span>
          <span class="gift-blurb">${esc(g.blurb)} ${g.days ? `Shown for ${g.days} days.` : "Shown forever."}</span>
        </span>
      </label>`,
  ).join("");
  return `<dialog class="giftmaker" data-gift-dialog aria-labelledby="gift-h">
    <form class="giftmaker-inner" data-gift-form>
      <h2 id="gift-h">Build ${esc(n.name)}'s Karma</h2>
      <p class="muted">Choose an offering to leave at ${esc(n.name)}'s niche.</p>
      <fieldset class="gift-grid"><legend class="visually-hidden">Choose a gift</legend>${options}</fieldset>
      <div class="grid-2">
        <div class="field"><label for="gift-from">From <span class="optional">(optional, shown with the gift)</span></label><input id="gift-from" name="from_name" type="text" maxlength="40" autocomplete="name"></div>
        <div class="field"><label for="gift-msg">A short message <span class="optional">(optional)</span></label><input id="gift-msg" name="message" type="text" maxlength="120"></div>
      </div>
      <p class="muted small">Secure payment by Stripe: card, PayNow, Apple Pay or Google Pay. Offerings are digital and appear at ${esc(n.name)}'s niche as soon as payment goes through.${stripeTestMode() ? " <strong>Test mode: no real money is charged.</strong>" : ""}</p>
      <p class="form-status" role="status" aria-live="polite" data-gift-status></p>
      <div class="actions cardmaker-actions">
        <button type="button" class="btn btn-outline" data-gift-close>Cancel</button>
        <button type="submit" class="btn btn-dark" data-gift-pay>Continue to payment</button>
      </div>
    </form>
  </dialog>`;
}

export function nichePage(opts: {
  niche: Niche;
  photos: Photo[];
  notes: Note[];
  base: string;
  gifts?: GiftRow[];
  shopOpen?: boolean;
  thanks?: string | null;
}) {
  const { niche: n, photos, notes, base } = opts;
  const gifts = opts.gifts ?? [];
  const shopOpen = !!opts.shopOpen;
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
  const annivLine = anniversaryToday(n);

  const gallery = photos.length
    ? `<section class="section-tight" aria-labelledby="gallery-h">
        <h2 id="gallery-h">Moments with ${esc(n.name)}</h2>
        <div class="gallery">
          ${photos
            .map((p, i) =>
              p.media === "video"
                ? `<a class="gallery-item is-video" href="/photo/${esc(p.key)}" data-lightbox data-video data-poster="/photo/${esc(p.poster_key ?? "")}">
                    <img src="/thumb/${esc(p.poster_key ?? "")}" alt="Video ${i + 1} of ${esc(n.name)}" loading="lazy" decoding="async">
                    <span class="play-badge">${icon.play}${p.duration ? `<span>${clock(p.duration)}</span>` : ""}</span>
                  </a>`
                : `<a class="gallery-item" href="/photo/${esc(p.key)}" data-lightbox>
                    <img src="/thumb/${esc(p.key)}" alt="Photo ${i + 1} of ${esc(n.name)}" loading="lazy" decoding="async">
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
       data-share-lit="${esc(litMsg)}"
       data-portrait="${esc(photoUrl(n.portrait_key) ?? "")}"
       data-dates="${esc(dates)}"
       data-line="${esc(n.plaque_line ?? "")}"
       data-host="${esc(base.replace(/^https?:\/\//, ""))}">
    ${opts.thanks ? `<div class="anniv gift-thanks" role="status"><span class="gift-art">${giftArt((getGift(opts.thanks)?.id ?? "bouquet") as GiftId)}</span><span>Thank you. Your ${esc(getGift(opts.thanks)?.name.toLowerCase() ?? "gift")} is now at ${esc(n.name)}'s niche, adding to their karma.</span><a class="btn btn-gold btn-sm" href="#gifts">See it</a></div>` : ""}
    ${annivLine ? `<div class="anniv" role="note">${icon.candle(22)}<span>${esc(annivLine)}</span><a class="btn btn-gold btn-sm" href="#tributes">Light a candle</a>${shopOpen ? `<button type="button" class="btn btn-outline btn-sm" data-open-gifts data-gift-pick="bundle">Build ${esc(n.name)}'s Karma</button>` : ""}</div>` : ""}
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
          <a class="btn btn-wa" data-share data-umami-event="Send a Light" data-umami-event-from="niche top" href="${esc(waLink(msg))}" target="_blank" rel="noopener" aria-label="Send a Light: share ${esc(n.name)}'s niche on WhatsApp">${icon.share()} Send a Light</a>
          <button type="button" class="btn btn-outline" data-open-card>${icon.card()} Story card</button>
          ${shopOpen ? `<button type="button" class="btn btn-gold btn-gift-top" data-open-gifts>${icon.flower()} Build ${esc(n.name)}'s Karma</button>` : ""}
        </div>
      </div>
    </section>

    ${gallery}

    ${giftShelf(n, gifts, shopOpen)}

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
        <a class="btn btn-wa btn-lg" data-share data-umami-event="Send a Light" data-umami-event-from="tributes" href="${esc(waLink(msg))}" target="_blank" rel="noopener" aria-label="Send a Light: share ${esc(n.name)}'s niche on WhatsApp">${icon.share(22)} Send a Light on WhatsApp</a>
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

    ${rememberSection(n, url)}
  </div>
  ${shopOpen ? giftDialog(n) : ""}
  <dialog class="cardmaker" data-card-dialog aria-labelledby="card-h">
    <div class="cardmaker-inner">
      <h2 id="card-h">Share ${esc(n.name)}'s story card</h2>
      <p class="muted small">Post it to your Instagram or Facebook story, or your WhatsApp status, so friends can find ${esc(n.name)}'s niche.</p>
      <div class="pills" role="group" aria-label="Card size">
        <button type="button" class="pill is-on" data-card-format="story" aria-pressed="true">Story · 9:16</button>
        <button type="button" class="pill" data-card-format="post" aria-pressed="false">Post · 4:5</button>
      </div>
      <div class="cardmaker-preview"><img alt="Story card for ${esc(n.name)}" data-card-img><span class="muted small" data-card-status>Painting the card…</span></div>
      <div class="actions cardmaker-actions">
        <button type="button" class="btn btn-wa" data-card-share hidden>${icon.share()} Share</button>
        <a class="btn btn-dark" data-card-download download="${esc(n.slug)}-starlight-garden.png" href="#">Save image</a>
        <button type="button" class="btn btn-outline" data-card-close>Close</button>
      </div>
    </div>
  </dialog>
  <dialog class="lightbox" data-lightbox-dialog aria-label="Photo viewer">
    <div class="lightbox-stage" data-stage>
      <img alt="" draggable="false">
      <video controls playsinline preload="metadata" hidden></video>
    </div>
    <div class="lightbox-bar">
      <button type="button" class="btn btn-ghost btn-sm" data-prev aria-label="Previous photo">‹ Prev</button>
      <span class="lightbox-count" data-count-label aria-live="polite"></span>
      <button type="button" class="btn btn-ghost btn-sm" data-next aria-label="Next photo">Next ›</button>
      <button type="button" class="btn btn-gold btn-sm" data-close>Close</button>
    </div>
    <p class="lightbox-hint">Swipe sideways for more photos · swipe up or down to close</p>
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
            <div class="field"><label for="name">Their name <span class="optional">(first name)</span></label><input id="name" name="name" type="text" maxlength="40" required autocomplete="off" autocapitalize="words" placeholder="e.g. Bella"></div>
            <div class="field"><label for="kind">They were a</label><select id="kind" name="kind">${kinds}</select></div>
            <div class="field"><label for="born">Born or welcomed home <span class="optional">(optional)</span></label><input id="born" name="born" type="date" max="${today}"></div>
            <div class="field"><label for="passed">Passed away <span class="optional">(optional)</span></label><input id="passed" name="passed" type="date" max="${today}"></div>
          </div>
          <div class="field"><label for="plaque_line">A line for their plaque <span class="optional">(optional)</span></label><input id="plaque_line" name="plaque_line" type="text" maxlength="80" placeholder="Forever curled up in a sunbeam"></div>
          <div class="field"><label for="story">Their story <span class="optional">(optional)</span></label><textarea id="story" name="story" rows="6" maxlength="4000" placeholder="What made them who they were: their habits, the places they loved, what you miss most."></textarea></div>
          <div class="field"><label for="keeper_name">Kept by <span class="optional">(optional, shown on the niche)</span></label><input id="keeper_name" name="keeper_name" type="text" maxlength="60" placeholder="e.g. The Tan family"></div>
          <div class="remind-create">
            <label class="consent"><input type="checkbox" name="remind_me" data-remind-toggle> <span>Email me a week before and on their remembrance day, with ways to remember them (such as lighting a candle or sending flowers and keepsakes). I can unsubscribe at any time.</span></label>
            <div class="field" data-remind-email hidden><label for="remind_email">Your email <span class="optional">(never shown on the site)</span></label><input id="remind_email" name="remind_email" type="email" autocomplete="email" inputmode="email"></div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Their photos &amp; videos</legend>
          <label class="dropzone" for="photos" data-dropzone>
            ${icon.upload}
            <span class="dz-title">Drop photos or videos here, or choose from your device</span>
            <span class="dz-sub">Up to 12 in total · videos up to 60 seconds (3 at most)</span>
            <input id="photos" name="photos" type="file" accept="image/*,video/*" multiple class="visually-hidden">
          </label>
          <div class="thumbs" data-thumbs></div>
          <p class="muted small" data-thumbs-hint hidden>The photo with the gold border becomes their portrait on the Garden Wall. Tap another photo to choose it instead, or remove one with ×. Videos can't be the portrait.</p>
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
        <a class="btn btn-wa" data-done-share data-umami-event="Send a Light" data-umami-event-from="niche created" href="#" target="_blank" rel="noopener">${icon.share()} Send a Light</a>
        <a class="btn btn-outline" data-done-card href="/">${icon.card()} Make a story card</a>
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
        data-photo="${esc(thumbUrl(n.portrait_key) ?? "")}">
        <span class="star-dot" aria-hidden="true"></span><span class="star-name">${esc(n.name)}</span>
      </button>`;
    })
    .join("");

  const card = sel
    ? `<section class="sky-card" aria-live="polite" data-sky-card>
        <div class="sky-photo" data-sky-photo>${sel.portrait_key ? `<img src="${esc(thumbUrl(sel.portrait_key)!)}" alt="">` : icon.paw(36)}</div>
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

export function keeperPage(opts: { niche: Niche; notes: Note[]; photos: Photo[]; gifts?: GiftRow[]; token: string; base: string }) {
  const { niche: n, notes, photos, token, base } = opts;
  const keeperGiftRows = (opts.gifts ?? [])
    .map((g) => {
      const info = getGift(g.gift);
      return `<li class="note">
        <p><strong>${esc(info?.name ?? g.gift)}</strong>${g.from_name ? ` from ${esc(g.from_name)}` : ""}${g.message ? `: “${esc(g.message)}”` : ""}</p>
        <div class="note-row">
          <span class="muted small">${g.expires_at ? `until ${esc(shortDate(new Date(g.expires_at)))}` : "forever"}${g.hidden ? " · hidden" : ""}</span>
          <button type="button" class="btn btn-outline btn-sm" data-gift-hide="${g.id}" data-hidden="${g.hidden ? "1" : "0"}">${g.hidden ? "Show" : "Hide"}</button>
        </div>
      </li>`;
    })
    .join("");
  const today = new Date().toISOString().slice(0, 10);
  const kinds = KINDS.map((k) => `<option${k === n.kind ? " selected" : ""}>${k}</option>`).join("");
  const photoTiles = photos
    .map((p, i) => {
      const isPortrait = p.key === n.portrait_key;
      const isVideo = p.media === "video";
      return `<li class="kp-tile${isPortrait ? " is-portrait" : ""}">
        <img src="/thumb/${esc(isVideo ? p.poster_key ?? "" : p.key)}" alt="${isVideo ? "Video" : "Photo"} ${i + 1} of ${esc(n.name)}" loading="lazy" decoding="async">
        ${isPortrait ? `<span class="thumb-badge">Portrait</span>` : ""}
        ${isVideo ? `<span class="play-badge">${icon.play}${p.duration ? `<span>${clock(p.duration)}</span>` : ""}</span>` : ""}
        <div class="kp-actions">
          <button type="button" class="btn btn-outline btn-sm" data-photo-move="earlier" data-photo-id="${p.id}" aria-label="Move photo ${i + 1} earlier"${i === 0 ? " disabled" : ""}>‹</button>
          <button type="button" class="btn btn-outline btn-sm" data-photo-move="later" data-photo-id="${p.id}" aria-label="Move photo ${i + 1} later"${i === photos.length - 1 ? " disabled" : ""}>›</button>
          ${isPortrait || isVideo ? "" : `<button type="button" class="btn btn-outline btn-sm" data-photo-portrait="${p.id}">Make portrait</button>`}
          <button type="button" class="btn btn-danger btn-sm" data-photo-remove="${p.id}"${!isVideo && photos.filter((x) => x.media === "image").length === 1 ? " disabled" : ""} aria-label="Remove ${isVideo ? "video" : "photo"} ${i + 1}">Remove</button>
        </div>
      </li>`;
    })
    .join("");
  const room = 12 - photos.length;
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
    <section class="section-tight card" aria-labelledby="kp-photos-h">
      <h2 id="kp-photos-h">Photos &amp; videos</h2>
      <p class="muted">The photo marked Portrait is shown on the Garden Wall and at the top of the niche. Use ‹ and › to change the order of the album. Videos can be up to 60 seconds (3 at most).</p>
      <ul class="kp-grid">${photoTiles}</ul>
      ${
        room > 0
          ? `<div class="kp-add">
              <label class="btn btn-sage" for="kp-photos">Add photos or videos</label>
              <input id="kp-photos" type="file" accept="image/*,video/*" multiple class="visually-hidden" data-photo-add>
              <span class="muted small">You can add ${room} more.</span>
            </div>`
          : `<p class="muted small">This niche holds the most it can (12). Remove one to add another.</p>`
      }
      <p class="form-status" role="status" aria-live="polite" data-photo-status></p>
    </section>

    <section class="section-tight card" aria-labelledby="kp-details-h">
      <h2 id="kp-details-h">Details</h2>
      <form class="kp-details" data-details-form novalidate>
        <div class="grid-2">
          <div class="field"><label for="kd-name">Their name <span class="optional">(first name)</span></label><input id="kd-name" name="name" type="text" maxlength="40" required value="${esc(n.name)}"></div>
          <div class="field"><label for="kd-kind">They were a</label><select id="kd-kind" name="kind">${kinds}</select></div>
          <div class="field"><label for="kd-born">Born or welcomed home <span class="optional">(optional)</span></label><input id="kd-born" name="born" type="date" max="${today}" value="${esc(n.born ?? "")}"></div>
          <div class="field"><label for="kd-passed">Passed away <span class="optional">(optional)</span></label><input id="kd-passed" name="passed" type="date" max="${today}" value="${esc(n.passed ?? "")}"></div>
        </div>
        <div class="field"><label for="kd-line">A line for their plaque <span class="optional">(optional)</span></label><input id="kd-line" name="plaque_line" type="text" maxlength="80" value="${esc(n.plaque_line ?? "")}"></div>
        <div class="field"><label for="kd-story">Their story <span class="optional">(optional)</span></label><textarea id="kd-story" name="story" rows="7" maxlength="4000">${esc(n.story ?? "")}</textarea></div>
        <div class="field"><label for="kd-keeper">Kept by <span class="optional">(optional, shown on the niche)</span></label><input id="kd-keeper" name="keeper_name" type="text" maxlength="60" value="${esc(n.keeper_name ?? "")}"></div>
        <div class="form-actions">
          <p class="form-status" role="status" aria-live="polite" data-details-status></p>
          <button class="btn btn-dark" type="submit">Save changes</button>
        </div>
      </form>
    </section>

    ${
      keeperGiftRows
        ? `<section class="section-tight">
            <h2>Karma offerings</h2>
            <p class="muted">Hiding an offering takes it off the niche page. It doesn't refund the person who sent it.</p>
            <ul class="notes">${keeperGiftRows}</ul>
            <p class="form-status" role="status" data-gift-hide-status></p>
          </section>`
        : ""
    }
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

export function unsubscribePage(opts: { token: string; name: string; email: string; done: boolean; already: boolean }) {
  const masked = opts.email.replace(/^(.{2})[^@]*(@.*)$/, "$1•••$2");
  const body = opts.done || opts.already
    ? `<h1 class="page-title">You're unsubscribed</h1>
       <p class="muted">We won't email ${esc(masked)} about ${esc(opts.name)} again. ${esc(opts.name)}'s niche is still here whenever you'd like to visit.</p>`
    : `<h1 class="page-title">Stop reminders about ${esc(opts.name)}?</h1>
       <p class="muted">We'll stop emailing ${esc(masked)} about ${esc(opts.name)}'s remembrance day.</p>
       <form method="post" action="/unsubscribe"><input type="hidden" name="t" value="${esc(opts.token)}"><button class="btn btn-dark" type="submit">Unsubscribe</button></form>`;
  return layout({
    title: `Email reminders · ${SITE_NAME}`,
    header: "compact",
    noindex: true,
    body: `<div class="wrap section center message">${body}<a class="btn btn-outline" href="/">Return to the garden</a></div>`,
  });
}

export function privacyPage() {
  return layout({
    title: `Privacy · ${SITE_NAME}`,
    header: "compact",
    body: `<div class="wrap section prose">
      <h1 class="page-title">Privacy</h1>
      <p class="muted">Last updated 4 November 2026</p>
      <h2>What we keep</h2>
      <ul>
        <li><strong>Niches:</strong> the pet's name, dates, words and the photos and videos you upload. These are public on the site so friends and family can visit.</li>
        <li><strong>Notes:</strong> the note and the name you give (if any). These are public on the pet's niche.</li>
        <li><strong>Candles and flowers:</strong> only a count. We don't record who left them.</li>
        <li><strong>Email reminders:</strong> if you ask for them, your email address, which pet it's for, and when and how you agreed. Your email is never shown on the site.</li>
        <li><strong>Visits:</strong> we count page visits with Umami, which doesn't use cookies or identify you, and we respect "Do Not Track".</li>
      </ul>
      <h2>Email reminders</h2>
      <p>We only email people who tick the box asking for reminders. Each email has an unsubscribe link, and unsubscribing stops all reminders about that pet. We don't sell or share email addresses.</p>
      <h2>Gifts and payments</h2>
      <p>Gifts are paid through Stripe. Your card or PayNow details go straight to Stripe; we never see or store them. We keep which gift was sent, the name and message you add (shown with the gift), and the amount. Gifts are digital and show at the niche for the time described when you choose them.</p>
      <h2>Removing things</h2>
      <p>Whoever created a niche can edit it or remove it, along with its photos, videos and notes, using their private keeper link. If you've lost it, or want your email or a note removed, contact the site owner.</p>
    </div>`,
  });
}

export function adminLoginPage(error = "") {
  return layout({
    title: `Owner · ${SITE_NAME}`,
    header: "compact",
    noindex: true,
    body: `<div class="wrap section admin">
      <h1 class="page-title">Owner tools</h1>
      <p class="muted lede-dark">For the site owner only.</p>
      <form class="card admin-login" method="post" action="/admin">
        <div class="field"><label for="admin-key">Owner key</label><input id="admin-key" name="key" type="password" autocomplete="current-password" required></div>
        ${error ? `<p class="form-status is-error" role="alert">${esc(error)}</p>` : ""}
        <button class="btn btn-dark" type="submit">Open</button>
      </form>
    </div>`,
  });
}

export function adminListPage(
  niches: Niche[],
  key: string,
  issued?: { name: string; url: string },
  counts: Map<number, number> = new Map(),
  sales?: { byGift: { gift: string; n: number; cents: number }[]; last30: { n: number; cents: number } },
) {
  const totalSales = sales ? sales.byGift.reduce((a, r) => a + r.cents, 0) : 0;
  const salesRows = sales
    ? sales.byGift.map((r) => `<li class="admin-row"><span>${esc(getGift(r.gift)?.name ?? r.gift)}</span><span class="muted">${r.n} sold · ${esc(price(r.cents))}</span></li>`).join("")
    : "";
  const totalReminders = [...counts.values()].reduce((a, b) => a + b, 0);
  const rows = niches
    .map(
      (n) => `<li class="admin-row">
        <span><strong>${esc(n.name)}</strong> <span class="muted small">· ${esc(n.kind)} · /pet/${esc(n.slug)}${n.keeper_name ? ` · kept by ${esc(n.keeper_name)}` : ""}${n.passed ? ` · remembrance ${esc(n.passed.slice(5))}` : ""} · ${counts.get(n.id) ?? 0} reminder sign-ups</span></span>
        <form method="post" action="/admin/keeper-link">
          <input type="hidden" name="key" value="${esc(key)}">
          <input type="hidden" name="slug" value="${esc(n.slug)}">
          <button class="btn btn-outline btn-sm" type="submit">New keeper link</button>
        </form>
      </li>`,
    )
    .join("");
  return layout({
    title: `Owner · ${SITE_NAME}`,
    header: "compact",
    noindex: true,
    body: `<div class="wrap section admin">
      <h1 class="page-title">Owner tools</h1>
      ${
        issued
          ? `<div class="card keeper-box" role="status">
              <p><strong>New keeper link for ${esc(issued.name)}.</strong> Send it only to the pet's owner. Their old keeper link no longer works.</p>
              <div class="copy-row"><input type="text" readonly value="${esc(issued.url)}" aria-label="New keeper link" data-keeper-url><button type="button" class="btn btn-outline" data-copy>Copy link</button></div>
              <div class="actions"><a class="btn btn-dark" href="${esc(issued.url)}">Open keeper page</a></div>
            </div>`
          : ""
      }
      <section class="section-tight card">
        <h2>Gift sales</h2>
        <p class="muted">${sales ? `${esc(price(totalSales))} in total · ${sales.last30.n} gifts (${esc(price(sales.last30.cents))}) in the last 30 days.` : ""} Amounts are before Stripe's fees. Your Stripe dashboard has the full detail.</p>
        ${salesRows ? `<ul class="admin-list">${salesRows}</ul>` : `<p class="muted small">No gifts yet.</p>`}
      </section>
      <section class="section-tight card">
        <h2>Email reminder list</h2>
        <p class="muted">${totalReminders} active sign-ups. Download them as a spreadsheet (CSV) with each person's consent and unsubscribe link, ready for your email service.</p>
        <form method="post" action="/admin/reminders.csv">
          <input type="hidden" name="key" value="${esc(key)}">
          <button class="btn btn-dark" type="submit">Download reminder list</button>
        </form>
      </section>
      <section class="section-tight">
        <h2>Niches (${niches.length})</h2>
        <p class="muted">Issue a fresh private keeper link when an owner has lost theirs. It replaces the old link.</p>
        <ul class="admin-list">${rows || `<li class="muted">No niches yet.</li>`}</ul>
      </section>
    </div>`,
  });
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
