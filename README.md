# Stocklens

A mobile-first stock watchlist and decision-support app. Track names you care about, see daily signals, get ranked buy ideas from your list, sync a Vested portfolio, and review positions that may deserve a second look—all behind invite-only Google sign-in.

Built with **Next.js 16**, **Supabase**, **NextAuth**, and live market data from **Yahoo Finance** + **Finnhub**, with optional **Google Gemini** narratives.

---

## Features

### Watchlist (tab 1)

- **Search & add** US tickers via Yahoo search (sector normalized for grouping).
- **Sector groups** — Technology, Healthcare, Financials, etc., sorted by today’s % change within each sector.
- **Live prices** — Yahoo chart API; auto-refresh every **15 seconds** with a compact countdown header (“Your watchlist”).
- **Rich cards** per stock:
  - Price and 1-day change
  - 7d / 14d / 30d performance
  - 52-week range with current price marker
  - Analyst buy / hold / sell bar
  - **Target price** — analyst consensus when available, otherwise 52-week high fallback
- **Trending suggestions** (collapsible) — up to 3 names **not** on your list:
  - Sourced from Yahoo **day gainers** + **most active** screeners
  - Rule-based scoring (momentum + analyst buy consensus)
  - Optional Gemini one-line blurbs (no duplicate stats on the card)
  - 6h global cache; fundamentals ~30m
- Max **30** watchlist tickers per user.

### Signals (tab 2)

- Scores every watchlist stock from price action, fundamentals, and news tone.
- **Bullish** / **Bearish** / **Quiet** sections — all **collapsible** (Quiet collapsed by default).
- Expand a signal card for headline links (Google News RSS).
- Refresh via header ↻ or on load.

### Picks (tab 3)

- Ranks **buy candidates only from your watchlist** (not the whole market).
- Scoring uses momentum, analyst ratings, 52-week position, news sentiment, and upside vs target (Yahoo analyst consensus when Finnhub paid target is unavailable; 52w high or momentum only as last resort).
- **Confidence** — High / Medium / Low; sorted by confidence then score.
- Each pick shows buy zone, target, upside, factor chips, and thesis.
- Optional **Gemini** thesis + risk (cached ~6h in `pick_narratives`).
- Manual refresh with `?refresh=1` (bypasses browser cache).

### Portfolio (tab 4)

- **Vested sync** — upload `.xlsx` with a `Holdings` sheet (Ticker, shares, average cost).
- **Portfolio value** summary — invested, total P&L, live value.
- **Your holdings** list with live prices and the same **15s refresh** header as watchlist.
- **Portfolio review** — conservative alerts for positions that look weak to hold 1–3 more months (multi-factor, not “sell now”):
  - Optional Gemini review text (cached)
  - Preview sample cards when empty
- Per-user holdings and sync metadata; shared fundamentals cache.

### Auth & access

- **Google OAuth** via NextAuth v5.
- **Email whitelist** in Supabase `allowed_emails` — unlisted users see “Access denied”.
- Session exposes `user.id` for all per-user API routes.
- Middleware (`src/proxy.ts`) redirects unauthenticated users to `/login`.

### PWA / mobile

- Bottom tab navigation, safe-area insets, 44px+ touch targets.
- `viewport-fit=cover`, `manifest.json` for add-to-home-screen.
- Dark UI tuned for phone-first use.

---

## Tech stack

| Layer | Choice |
|--------|--------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4, Lucide icons |
| Auth | NextAuth 5 + Google provider |
| Database | Supabase (Postgres + RLS) |
| Client data | SWR |
| Market data | Yahoo Finance (quotes, screeners, charts), Finnhub (recommendations, news sentiment) |
| LLM (optional) | Google Gemini API |
| Portfolio import | `xlsx` (Vested export) |

---

## Data model (high level)

**Per-user** (always filtered by `user_id`):

- `watchlist_stocks`
- `portfolio_holdings`, portfolio sync fields
- User-specific narrative dismissals / preferences where applicable

**Shared** (no `user_id` — populated by server jobs/API):

- `stock_fundamentals` — cached Yahoo + Finnhub per ticker (~30 min)
- `pick_narratives`, `portfolio_sell_narratives` — LLM cache
- `watchlist_suggestions_cache` — global trending pool (6h)
- News fetched on demand; not stored as a full feed table for all users

See `supabase/migrations/` and project rules in `AGENTS.md`.

---

## Prerequisites

- **Node.js** 20+ (LTS recommended)
- **npm**
- **Supabase** project
- **Google Cloud** OAuth client (Web application)
- **Finnhub** API key (free tier works for recommendations/sentiment; analyst targets also come from Yahoo)
- **Gemini API key** (optional, for AI blurbs/theses)

---

## Local setup

### 1. Clone and install

```bash
git clone <your-repo-url> stocklens
cd stocklens
npm install
```

### 2. Environment variables

Copy the example file and fill in values:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXTAUTH_URL` | Yes | `http://localhost:3000` in dev |
| `NEXTAUTH_SECRET` | Yes | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Yes | OAuth 2.0 Web client |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth client secret |
| `SUPABASE_URL` | Yes | Project URL |
| `SUPABASE_ANON_KEY` | Yes | Anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only; never expose to client |
| `FINNHUB_API_KEY` | Yes | Stock recommendations & sentiment |
| `GEMINI_API_KEY` | No | AI narratives; app works without it |
| `DATABASE_URL` | No | Only for `node scripts/migrate.mjs` or dev migrate route |

### 3. Database migrations

**Recommended (Supabase SQL Editor):**

1. Open [Supabase](https://supabase.com) → your project → **SQL Editor**.
2. Run migrations in order, or run the combined file once:
   - `supabase/migrations/001_initial_schema.sql` — users, whitelist, watchlist, RLS
   - `004` … `008` as needed, or
   - `supabase/migrations/run_once_combined.sql` — bundles fundamentals, picks, portfolio alerts, suggestions cache

**Alternative (local script):**

```bash
# Add DATABASE_URL to .env.local (pooler URI from Supabase)
node scripts/migrate.mjs
```

**Dev-only HTTP runner** (not available in production):

```
GET http://localhost:3000/api/setup/migrate
```

### 4. Allow your Google account

In Supabase SQL Editor:

```sql
INSERT INTO allowed_emails (email) VALUES ('you@gmail.com');
```

### 5. Google OAuth redirect URIs

In Google Cloud Console → Credentials → your OAuth client:

- Authorized JavaScript origins: `http://localhost:3000` (and production URL)
- Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google` (and production equivalent)

### 6. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → sign in with an allowed Google account.

### 7. Production build

```bash
npm run build
npm start
```

Set the same env vars on your host (e.g. Vercel). Use your production URL for `NEXTAUTH_URL` and OAuth redirects.

---

## Project structure

```
src/
├── app/
│   ├── (app)/           # Main tabs: watchlist, news (signals), picks, portfolio
│   ├── api/             # REST routes (auth-protected except NextAuth)
│   ├── login/
│   └── globals.css      # Design tokens, page-shell, card-surface
├── components/
│   ├── AppNav.tsx       # Top bar + bottom tabs
│   ├── LiveRefreshHeader.tsx
│   └── watchlist/       # Cards, search, trending suggestions
├── lib/
│   ├── auth.ts
│   ├── supabase.ts      # Service-role server client
│   ├── fundamentals-fetch.ts
│   ├── picks.ts, portfolio-alerts.ts
│   ├── watchlist-suggestions.ts, market-movers.ts
│   ├── llm.ts           # Gemini (optional)
│   └── sectors.ts
└── proxy.ts             # Auth middleware
supabase/migrations/     # SQL schema
scripts/migrate.mjs      # Optional CLI migrator
```

---

## API routes (authenticated unless noted)

| Route | Purpose |
|-------|---------|
| `GET/POST /api/watchlist` | List / add watchlist |
| `DELETE /api/watchlist/[ticker]` | Remove ticker |
| `GET /api/watchlist/search?q=` | Yahoo ticker search |
| `GET /api/watchlist/suggestions` | Trending add ideas (`?refresh=1` busts cache) |
| `GET /api/fundamentals/[ticker]` | Cached fundamentals + refresh |
| `GET /api/signals` | Bullish / bearish / quiet signals |
| `GET /api/picks` | Ranked picks (`?refresh=1` for full rescan) |
| `GET /api/portfolio` | Holdings + live prices |
| `POST /api/portfolio/sync` | Vested XLSX upload |
| `GET /api/portfolio/alerts` | Portfolio review alerts |
| `GET /api/news` | Watchlist news (legacy/auxiliary) |
| `GET /api/auth/*` | NextAuth |
| `GET /api/setup/migrate` | Dev-only migrations |

---

## External services & limits

- **Yahoo Finance** — unofficial endpoints; use reasonable refresh intervals (app uses 15s live prices on open tabs).
- **Finnhub free tier** — `price-target` is paid-only; analyst targets use Yahoo `financialData` instead (52w / momentum only if both fail).
- **Gemini** — optional; picks/portfolio/trending use sequential calls with delays to reduce 429s.
- **Not financial advice** — scoring and copy are informational; user decides trades.

---

## Deployment checklist

- [ ] All env vars set on host (see `.env.example`)
- [ ] `NEXTAUTH_URL` matches production domain
- [ ] Google OAuth production redirect URIs added
- [ ] Supabase migrations applied
- [ ] Your email(s) in `allowed_emails`
- [ ] `npm run build` succeeds locally
- [ ] Never commit `.env.local` or service role keys

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Run production server |
| `npm run lint` | ESLint |
| `node scripts/migrate.mjs` | Apply SQL via `DATABASE_URL` |

---

## Roadmap / known gaps

See `TODO.md` for in-progress ideas (e.g. watchlist “remove” suggestions, further AI features).

---

## License

Private project — all rights reserved unless otherwise specified by the repository owner.
