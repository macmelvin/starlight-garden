# Starlight Garden

An online pet columbarium. Pet owners create a niche for a pet who has passed, upload their photos, and anyone can visit to light a candle, leave flowers or write a note. "Send a Light" shares a niche on WhatsApp to bring friends and family back to visit.

## Pages

| Route | What it is |
| --- | --- |
| `/` | The Garden Wall: search by name, filter by dogs / cats / small pets |
| `/create` | Create a niche: details, story, up to 12 photos, choose the portrait |
| `/pet/:slug` | A pet's niche: portrait, story, gallery, candles, flowers, notes, Send a Light |
| `/sky` | The Remembrance Sky: every pet is a star, brighter with more candles |
| `/keeper/:slug?token=…` | Private keeper page (link shown once after creating): remove notes, take the niche down |

There are no accounts. Whoever creates a niche gets a private keeper link; anyone with that link can manage the niche.

## Stack

- [Bun](https://bun.sh) server (`server.ts`), no framework, server-rendered HTML
- Postgres via `Bun.sql` — tables are created automatically on start
- Photos in an S3-compatible bucket via `Bun.s3`, streamed through `/photo/…`
- Photos are downscaled in the browser (max 2000px) before upload

## Environment variables

| Variable | On Railway |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `S3_ENDPOINT` | `${{photos.ENDPOINT}}` |
| `S3_BUCKET` | `${{photos.BUCKET}}` |
| `S3_REGION` | `${{photos.REGION}}` |
| `S3_ACCESS_KEY_ID` | `${{photos.ACCESS_KEY_ID}}` |
| `S3_SECRET_ACCESS_KEY` | `${{photos.SECRET_ACCESS_KEY}}` |
| `S3_URL_STYLE` | `virtual-host` (default) or `path` |
| `UMAMI_WEBSITE_ID` | your Umami website ID — turns on analytics |
| `UMAMI_SCRIPT_URL` | optional, only if you self-host Umami (defaults to Umami Cloud) |
| `PUBLIC_URL` | optional, e.g. `https://starlightgarden.sg` once you add a custom domain |

Railway sets `PORT` and `RAILWAY_PUBLIC_DOMAIN` itself.

## Run locally

```sh
bun install
DATABASE_URL=postgres://… S3_ENDPOINT=… S3_BUCKET=… S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… bun run dev
```

## Analytics (Umami)

Set `UMAMI_WEBSITE_ID` to switch it on. Besides page views it records these events:
Create niche click, Niche created, Niche create failed, Light a candle, Leave flowers,
Leave a note, and Send a Light (with where it was tapped). Query strings are not sent,
visitors with Do Not Track are skipped, and private keeper pages are never tracked.

## Limits and safeguards

- Up to 12 photos per niche, 15 MB each; files are checked by content, not just extension
- One candle and one bunch of flowers per visitor per niche (per 12 hours), plus per-IP rate limits on creating niches and notes
- All visitor text is HTML-escaped; strict Content-Security-Policy
- Rate limits are kept in memory, so they reset on redeploy and apply per instance
