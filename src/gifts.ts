// Digital gifts that visitors can leave at a niche, and the Stripe calls to pay for them.

import { timingSafeEqual } from "node:crypto";

export type GiftId = "treat" | "bouquet" | "plush" | "lantern" | "bundle" | "eternal";

export type Gift = {
  id: GiftId;
  name: string;
  blurb: string;
  cents: number; // SGD
  days: number | null; // null = forever
  includes?: GiftId[];
};

export const GIFTS: Gift[] = [
  { id: "treat", name: "Favourite treat", blurb: "A little treat, just for them.", cents: 200, days: 30 },
  { id: "bouquet", name: "Bouquet of flowers", blurb: "Fresh flowers for their niche.", cents: 300, days: 30 },
  { id: "plush", name: "Soft toy", blurb: "Something soft to snuggle.", cents: 400, days: 30 },
  { id: "lantern", name: "Lotus lantern", blurb: "A glowing lotus to light their way.", cents: 500, days: 30 },
  {
    id: "bundle",
    name: "Remembrance bundle",
    blurb: "Flowers, a lotus lantern and a soft toy together.",
    cents: 900,
    days: 30,
    includes: ["bouquet", "lantern", "plush"],
  },
  { id: "eternal", name: "Eternal lantern", blurb: "A lantern that stays lit at their niche forever.", cents: 2800, days: null },
];

export function getGift(id: unknown): Gift | null {
  return GIFTS.find((g) => g.id === id) ?? null;
}

export function price(cents: number): string {
  return `S$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
}

// ---------- artwork (inline SVG, no external files) ----------

const ART: Record<Exclude<GiftId, "bundle">, string> = {
  treat: `<svg viewBox="0 0 64 64" aria-hidden="true"><g transform="rotate(-25 32 32)"><rect x="18" y="27" width="28" height="10" rx="5" fill="#F3E3C3" stroke="#B98A4A" stroke-width="2"/><circle cx="17" cy="26" r="6" fill="#F3E3C3" stroke="#B98A4A" stroke-width="2"/><circle cx="17" cy="38" r="6" fill="#F3E3C3" stroke="#B98A4A" stroke-width="2"/><circle cx="47" cy="26" r="6" fill="#F3E3C3" stroke="#B98A4A" stroke-width="2"/><circle cx="47" cy="38" r="6" fill="#F3E3C3" stroke="#B98A4A" stroke-width="2"/><rect x="18" y="28.5" width="28" height="7" fill="#F3E3C3"/></g></svg>`,
  bouquet: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M24 36 L32 60 L40 36 Z" fill="#E7D6B8" stroke="#B9A07A" stroke-width="2" stroke-linejoin="round"/><path d="M32 40v18" stroke="#4E6B52" stroke-width="2"/><path d="M28 38c-4-4-9-4-11-2M36 38c4-4 9-4 11-2" stroke="#4E6B52" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="24" cy="24" r="7" fill="#F2A7B5"/><circle cx="40" cy="24" r="7" fill="#F6C66B"/><circle cx="32" cy="18" r="7" fill="#E98AA0"/><circle cx="32" cy="30" r="7" fill="#F7D9E0"/><circle cx="24" cy="24" r="2.4" fill="#C9677E"/><circle cx="40" cy="24" r="2.4" fill="#C98A2A"/><circle cx="32" cy="18" r="2.4" fill="#B9506A"/><circle cx="32" cy="30" r="2.4" fill="#D98FA2"/></svg>`,
  plush: `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="20" cy="18" r="7" fill="#D9B48A" stroke="#9C7448" stroke-width="2"/><circle cx="44" cy="18" r="7" fill="#D9B48A" stroke="#9C7448" stroke-width="2"/><circle cx="20" cy="18" r="3" fill="#F1D7B6"/><circle cx="44" cy="18" r="3" fill="#F1D7B6"/><ellipse cx="32" cy="46" rx="15" ry="13" fill="#D9B48A" stroke="#9C7448" stroke-width="2"/><circle cx="32" cy="28" r="14" fill="#D9B48A" stroke="#9C7448" stroke-width="2"/><ellipse cx="32" cy="33" rx="6" ry="4.5" fill="#F1D7B6"/><circle cx="27" cy="26" r="1.8" fill="#3B2A1C"/><circle cx="37" cy="26" r="1.8" fill="#3B2A1C"/><ellipse cx="32" cy="31.5" rx="2" ry="1.5" fill="#3B2A1C"/><path d="M28 44c2 2 6 2 8 0" stroke="#E98AA0" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  lantern: `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="34" r="20" fill="#E8B04B" opacity=".18"/><path d="M32 18c-3 6-3 12 0 18 3-6 3-12 0-18z" fill="#F7C7D3" stroke="#D07C93" stroke-width="1.5"/><path d="M32 36c-6-2-11-7-12-14 6 1 10 6 12 14z" fill="#F4B3C4" stroke="#D07C93" stroke-width="1.5"/><path d="M32 36c6-2 11-7 12-14-6 1-10 6-12 14z" fill="#F4B3C4" stroke="#D07C93" stroke-width="1.5"/><path d="M16 38c6 3 26 3 32 0-2 6-9 9-16 9s-14-3-16-9z" fill="#9BC3A1" stroke="#4E6B52" stroke-width="1.5"/><path d="M32 22c1.2 1.6 1.6 3 1.6 4a1.6 1.6 0 0 1-3.2 0c0-1 .4-2.4 1.6-4z" fill="#FFE29A"/></svg>`,
  eternal: `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="#E8B04B" opacity=".16"/><circle cx="32" cy="32" r="18" fill="#E8B04B" opacity=".18"/><path d="M26 14h12l-2 4H28z" fill="#B88A2E"/><rect x="24" y="18" width="16" height="28" rx="6" fill="#FFF3D1" stroke="#B88A2E" stroke-width="2"/><path d="M32 24c2.4 3.2 3.2 5.6 3.2 7.6a3.2 3.2 0 0 1-6.4 0c0-2 .8-4.4 3.2-7.6z" fill="#F2A33A"/><path d="M32 28c1.2 1.6 1.6 2.8 1.6 3.8a1.6 1.6 0 0 1-3.2 0c0-1 .4-2.2 1.6-3.8z" fill="#FFE29A"/><path d="M22 46h20l-2 4H24z" fill="#B88A2E"/><path d="M10 12l1.2 2.8L14 16l-2.8 1.2L10 20l-1.2-2.8L6 16l2.8-1.2zM54 8l.9 2.1L57 11l-2.1.9L54 14l-.9-2.1L51 11l2.1-.9z" fill="#E8B04B"/></svg>`,
};

export function giftArt(id: GiftId): string {
  if (id === "bundle") {
    return `<span class="gift-art-bundle">${ART.bouquet}${ART.lantern}${ART.plush}</span>`;
  }
  return ART[id];
}

// ---------- Stripe ----------

const STRIPE_API = (process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/$/, "");

export function giftsEnabled(): boolean {
  return /^sk_(test|live)_/.test(process.env.STRIPE_SECRET_KEY ?? "");
}

export function stripeTestMode(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");
}

function form(data: Record<string, string>): string {
  return new URLSearchParams(data).toString();
}

async function stripe(path: string, init: { method: "GET" | "POST"; body?: Record<string, string> }) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2024-06-20",
    },
    body: init.body ? form(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) {
    console.error("Stripe error", res.status, json?.error?.message);
    throw new Error(json?.error?.message || "Payment service error");
  }
  return json;
}

export async function createCheckout(opts: {
  gift: Gift;
  petName: string;
  giftRowId: number;
  successUrl: string;
  cancelUrl: string;
}) {
  return stripe("/v1/checkout/sessions", {
    method: "POST",
    body: {
      mode: "payment",
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "sgd",
      "line_items[0][price_data][unit_amount]": String(opts.gift.cents),
      "line_items[0][price_data][product_data][name]": `${opts.gift.name} for ${opts.petName}`,
      "line_items[0][price_data][product_data][description]": opts.gift.days
        ? `A digital gift shown at ${opts.petName}'s niche on Starlight Garden for ${opts.gift.days} days.`
        : `A digital gift shown at ${opts.petName}'s niche on Starlight Garden for good.`,
      "metadata[gift_row_id]": String(opts.giftRowId),
      "metadata[gift]": opts.gift.id,
      "payment_intent_data[description]": `${opts.gift.name} for ${opts.petName} (Starlight Garden)`,
      submit_type: "pay",
      locale: "auto",
    },
  }) as Promise<{ id: string; url: string }>;
}

export async function getCheckout(id: string) {
  return stripe(`/v1/checkout/sessions/${encodeURIComponent(id)}`, { method: "GET" }) as Promise<{
    id: string;
    payment_status: string;
    amount_total: number;
    currency: string;
    metadata: Record<string, string>;
  }>;
}

/** Verifies a Stripe webhook signature (v1, HMAC-SHA256) and returns the event, or null. */
export async function verifyWebhook(payload: string, header: string | null): Promise<Record<string, any> | null> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return null;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)];
    }),
  );
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 600) return null;
  const sigs = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  const expected = new Bun.CryptoHasher("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const ok = sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
