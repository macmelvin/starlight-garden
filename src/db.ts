import { SQL } from "bun";

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL is not set — the app cannot store niches until it is.");
}

export const sql = new SQL(process.env.DATABASE_URL ?? "postgres://localhost/starlight");

export const KINDS = [
  "Dog", "Cat", "Rabbit", "Bird", "Hamster", "Guinea pig", "Fish", "Turtle", "Other friend",
] as const;

export type Niche = {
  id: number;
  slug: string;
  name: string;
  kind: string;
  born: string | null;
  passed: string | null;
  plaque_line: string | null;
  story: string | null;
  keeper_name: string | null;
  keeper_token_hash: string;
  portrait_key: string | null;
  candles: number;
  flowers: number;
  created_at: Date;
};

export type Photo = {
  id: number;
  key: string;
  position: number;
  media: "image" | "video";
  poster_key: string | null;
  duration: number | null;
};
export type Note = { id: number; author: string | null; body: string; created_at: Date };

export async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS niches (
      id SERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      born DATE,
      passed DATE,
      plaque_line TEXT,
      story TEXT,
      keeper_name TEXT,
      keeper_token_hash TEXT NOT NULL,
      portrait_key TEXT,
      candles INTEGER NOT NULL DEFAULT 0,
      flowers INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS photos (
      id SERIAL PRIMARY KEY,
      niche_id INTEGER NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS notes (
      id SERIAL PRIMARY KEY,
      niche_id INTEGER NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
      author TEXT,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`ALTER TABLE photos ADD COLUMN IF NOT EXISTS media TEXT NOT NULL DEFAULT 'image'`;
  await sql`ALTER TABLE photos ADD COLUMN IF NOT EXISTS poster_key TEXT`;
  await sql`ALTER TABLE photos ADD COLUMN IF NOT EXISTS duration REAL`;
  await sql`CREATE INDEX IF NOT EXISTS photos_niche_idx ON photos(niche_id, position)`;
  await sql`CREATE INDEX IF NOT EXISTS notes_niche_idx ON notes(niche_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS niches_created_idx ON niches(created_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS reminders (
      id SERIAL PRIMARY KEY,
      niche_id INTEGER NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'visitor',
      consent_text TEXT NOT NULL,
      consent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      unsubscribe_token TEXT NOT NULL UNIQUE,
      unsubscribed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (niche_id, email)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS reminders_niche_idx ON reminders(niche_id)`;
  // Pets are shown by first name only, with a capital first letter ("BELLA NG" -> "Bella").
  await sql`
    UPDATE niches SET name = initcap(split_part(btrim(name), ' ', 1))
    WHERE name <> initcap(split_part(btrim(name), ' ', 1))`;
}

export async function getNiche(slug: string): Promise<Niche | null> {
  const rows = await sql`SELECT
      id, slug, name, kind,
      to_char(born, 'YYYY-MM-DD') AS born,
      to_char(passed, 'YYYY-MM-DD') AS passed,
      plaque_line, story, keeper_name, keeper_token_hash, portrait_key,
      candles, flowers, created_at
    FROM niches WHERE slug = ${slug} LIMIT 1`;
  return (rows[0] as Niche) ?? null;
}

export async function listNiches(opts: { q?: string; kind?: string; limit?: number }): Promise<Niche[]> {
  const q = opts.q?.trim() ? `%${opts.q.trim().replace(/[\\%_]/g, "\\$&")}%` : null;
  const kind = opts.kind ?? "all";
  const limit = opts.limit ?? 60;
  const rows = await sql`
    SELECT
      id, slug, name, kind,
      to_char(born, 'YYYY-MM-DD') AS born,
      to_char(passed, 'YYYY-MM-DD') AS passed,
      plaque_line, story, keeper_name, keeper_token_hash, portrait_key,
      candles, flowers, created_at
    FROM niches
    WHERE (${q}::text IS NULL OR name ILIKE ${q})
      AND (
        ${kind}::text = 'all'
        OR (${kind}::text = 'dogs' AND kind = 'Dog')
        OR (${kind}::text = 'cats' AND kind = 'Cat')
        OR (${kind}::text = 'small' AND kind NOT IN ('Dog', 'Cat'))
      )
    ORDER BY created_at DESC
    LIMIT ${limit}`;
  return rows as Niche[];
}

export async function countNiches(): Promise<number> {
  const rows = await sql`SELECT count(*)::int AS n FROM niches`;
  return rows[0]?.n ?? 0;
}

export async function getPhotos(nicheId: number): Promise<Photo[]> {
  return (await sql`
    SELECT id, key, position, media, poster_key, duration FROM photos
    WHERE niche_id = ${nicheId} ORDER BY position, id`) as Photo[];
}

export async function getNotes(nicheId: number, limit = 100): Promise<Note[]> {
  return (await sql`
    SELECT id, author, body, created_at FROM notes
    WHERE niche_id = ${nicheId}
    ORDER BY created_at DESC
    LIMIT ${limit}`) as Note[];
}

export async function listPortraits(limit = 30): Promise<{ name: string; portrait_key: string }[]> {
  return (await sql`
    SELECT name, portrait_key FROM niches
    WHERE portrait_key IS NOT NULL
    ORDER BY created_at DESC
    LIMIT ${limit}`) as { name: string; portrait_key: string }[];
}

// ---------- email reminder opt-ins ----------

export function consentText(petName: string): string {
  return `Email me a week before and on ${petName}'s remembrance day, with ways to remember them (such as lighting a candle or sending flowers and keepsakes). I can unsubscribe at any time.`;
}

export async function addReminder(nicheId: number, petName: string, email: string, role: "keeper" | "visitor", token: string) {
  await sql`
    INSERT INTO reminders (niche_id, email, role, consent_text, unsubscribe_token)
    VALUES (${nicheId}, ${email}, ${role}, ${consentText(petName)}, ${token})
    ON CONFLICT (niche_id, email) DO UPDATE SET
      unsubscribed_at = NULL,
      consent_at = now(),
      consent_text = EXCLUDED.consent_text,
      role = CASE WHEN reminders.role = 'keeper' THEN 'keeper' ELSE EXCLUDED.role END`;
}

export async function findReminder(token: string) {
  const rows = await sql`
    SELECT r.id, r.email, r.unsubscribed_at, n.name, n.slug
    FROM reminders r JOIN niches n ON n.id = r.niche_id
    WHERE r.unsubscribe_token = ${token} LIMIT 1`;
  return (rows[0] as { id: number; email: string; unsubscribed_at: Date | null; name: string; slug: string }) ?? null;
}

export async function unsubscribeReminder(id: number) {
  await sql`UPDATE reminders SET unsubscribed_at = now() WHERE id = ${id} AND unsubscribed_at IS NULL`;
}

export async function reminderCounts(): Promise<Map<number, number>> {
  const rows = await sql`SELECT niche_id, count(*)::int AS n FROM reminders WHERE unsubscribed_at IS NULL GROUP BY niche_id`;
  return new Map((rows as { niche_id: number; n: number }[]).map((r) => [r.niche_id, r.n]));
}

export async function exportReminders() {
  return (await sql`
    SELECT r.email, r.role, n.name AS pet, n.slug, to_char(n.passed, 'YYYY-MM-DD') AS remembrance_day,
           r.consent_at, r.consent_text, r.unsubscribe_token
    FROM reminders r JOIN niches n ON n.id = r.niche_id
    WHERE r.unsubscribed_at IS NULL
    ORDER BY n.passed NULLS LAST, n.name, r.email`) as {
    email: string; role: string; pet: string; slug: string; remembrance_day: string | null;
    consent_at: Date; consent_text: string; unsubscribe_token: string;
  }[];
}
