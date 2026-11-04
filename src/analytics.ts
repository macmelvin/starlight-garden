// Umami analytics. Switched on by setting UMAMI_WEBSITE_ID (and UMAMI_SCRIPT_URL
// when self-hosting). Query strings are never sent, and private keeper pages are
// never tracked, so keeper links can't leak into analytics.

const websiteId = process.env.UMAMI_WEBSITE_ID?.trim() || "";
const scriptUrl = process.env.UMAMI_SCRIPT_URL?.trim() || "https://cloud.umami.is/script.js";

export const analyticsEnabled = /^[0-9a-f-]{36}$/i.test(websiteId);

let scriptOrigin = "";
try {
  scriptOrigin = new URL(scriptUrl).origin;
} catch {}

/** Extra origins the Content-Security-Policy must allow. */
export const analyticsOrigins: string[] = analyticsEnabled && scriptOrigin
  ? scriptOrigin === "https://cloud.umami.is"
    ? [scriptOrigin, "https://api-gateway.umami.dev"]
    : [scriptOrigin]
  : [];

export function analyticsTag(): string {
  if (!analyticsEnabled || !scriptOrigin) return "";
  return `<script defer src="${scriptUrl}" data-website-id="${websiteId}" data-exclude-search="true" data-do-not-track="true"></script>`;
}
