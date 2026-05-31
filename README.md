# Stocklens

A mobile-first stock watchlist and decision-support app for US equities. Track names you care about, get ranked buy ideas from your watchlist and portfolio, sync a Vested portfolio, review holdings with daily summaries, and optionally receive a WhatsApp briefing—all behind invite-only Google sign-in.

Built with **Next.js 16**, **Supabase**, **NextAuth**, live prices from **Yahoo Finance**, fundamentals from **Finnhub** + a multi-source analyst target chain, and optional **Google Gemini** narratives.

---

## Features

### Watchlist

- **Search & add** US tickers via Yahoo search (sector normalized for grouping).
- **Custom tags** — label stocks and group by tag; suggested tag hints; up to a few tags per name.
- **Sort / filter** — sector, tag, day change, target upside, alphabetical, **bullish**, or **bearish** (signal-based).
- **Live prices** during US regular hours (9:30 AM–4:00 PM ET):
  - **13s progress bar** + auto-refresh while market is open
  - **Closing prices** when market is closed (grey **Closed** badge)
- **Rich expandable cards** per stock:
  - Price, day change, **day high / day low**
  - Signal reason chips + linked headlines (bullish / bearish / quiet)
  - 7d / 14d / 30d performance, 52-week range
  - Analyst buy / hold / sell bar
  - **Target price** with upside vs current (analyst consensus when available)
  - **Key research** panel — earnings date, revenue/earnings growth, P/E vs sector (cached)
  - **Vs sector** relative strength when benchmark data exists
- **Trending suggestions** (collapsible) — up to 3 names not on your list; skip/dismiss support; optional Gemini blurbs; 3h global cache.
- **Cache-first fundamentals** — batch API returns DB cache immediately; stale rows refresh in background.
- Max **30** watchlist tickers per user.

### Picks

- Ranks **top 10 buy candidates globally** from:
  - Your **watchlist**
  - Your **portfolio** (tickers you hold but may not watch)
  - **Discovery** — strong movers from trending screeners you don't already own
- **Source filter** — All / Your picks / Discovery (persisted in session).
- Scoring uses momentum, analyst ratings, 52-week position, news sentiment, upside vs target, **sector-relative strength**, and **research metrics** (earnings proximity, growth, volume).
- Each pick shows confidence, buy zone, target, upside, factor chips, price chart, vs-sector panel, and expandable research.
- Optional **Gemini** thesis + risk + company blurb (cached ~3h in `pick_narratives`; LLM runs in background, client polls `/api/picks/narratives`).
- **Prices & scores** timestamp shown separately from AI narrative freshness.

### Portfolio

- **Vested sync** — upload `.xlsx` with a `Holdings` sheet (Ticker, shares, average cost).
- **Portfolio value** — invested, total P&L, live value; **Closed** badge + timestamp when market is closed.
- **Daily summary** (collapsible) — AI-generated editorial overview of your holdings (cached ~3h; cron-refreshed on market days).
- **Holdings views** — compact list or table; sorted by P&L; **13s live refresh** during regular hours.
- **Per-holding signals** — attention / soft / profit tiers with factor chips and expandable detail (merged from portfolio + watchlist signal logic).
- Per-user holdings; shared fundamentals and summary cache keyed by portfolio hash.

### Settings

- **WhatsApp daily briefing** — opt in with Indian mobile number; sent **10:30 AM ET** on US market days (Mon–Fri) via Twilio.
- Account header and app version.

### Auth & access

- **Google OAuth** via NextAuth v5.
- **Email whitelist** in Supabase `allowed_emails` — unlisted users see “Access denied”.
- Session exposes `user.id` for all per-user API routes.
- Middleware redirects unauthenticated users to `/login`.

### PWA / mobile

- Bottom tab navigation (Watchlist · Picks · Portfolio), Settings in header.
- Safe-area insets, 44px+ touch targets, dark phone-first UI.
- `viewport-fit=cover`, `manifest.json` for add-to-home-screen.

---

## Tech stack

| Layer | Choice |
|--------|--------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4, Lucide icons |
| Auth | NextAuth 5 + Google provider |
| Database | Supabase (Postgres + RLS) |
| Client data | SWR |
| Market data | Yahoo Finance (quotes, charts, screeners) |
| Fundamentals | Finnhub (recommendations, sentiment); Yahoo charts (52w, momentum) |
| Analyst targets | StockAnalysis → FMP → Eulerpool → Finnhub → Yahoo → 52w high (daily reset 5pm IST) |
| Research | Cached earnings/growth metrics in `stock_research_cache` |
| LLM (optional) | Google Gemini (`gemini-2.5-flash`) |
| WhatsApp (optional) | Twilio |
| Portfolio import | `xlsx` (Vested export) |

---

## Data model (high level)

**Per-user** (filtered by `user_id`):

- `watchlist_stocks`, `watchlist_tags`
- `portfolio_holdings`, portfolio sync metadata
- `portfolio_daily_summaries` (keyed by user + holdings hash)
- User settings (WhatsApp number, opt-in) on `users.preferences`
- Trending skip list per user

**Shared** (no `user_id`):

- `stock_fundamentals` — price fields ~30 min; targets daily 5pm IST
- `stock_research_cache` — earnings, growth, volume metrics
- `pick_narratives` — LLM thesis / risk / company blurb (~3h TTL)
- `portfolio_sell_narratives` — sell-review text cache
- `watchlist_suggestions_cache` — global trending pool (~3h)
- `stock_logos`, `sector_benchmarks`

See `supabase/migrations/` and `AGENTS.md`.

---

## Scheduled jobs (Vercel cron)

Requires `CRON_SECRET` (`Authorization: Bearer …` on cron routes).

| Cron | Schedule (UTC) | Purpose |
|------|------------------|---------|
| `/api/cron/refresh-targets` | 15:30 Mon–Fri | Bulk refresh analyst targets |
| `/api/cron/refresh-research` | 16:00 Mon–Fri | Refresh stale `stock_research_cache` |
| `/api/cron/refresh-portfolio-summaries` | 16:30 Mon–Fri | Regenerate stale portfolio daily summaries |
| `/api/cron/send-whatsapp-briefings` | 15:30 Mon–Fri | Send WhatsApp briefings (~10:30 AM ET window) |

Configured in `vercel.json`.

---

## Prerequisites

- **Node.js** 20+
- **Supabase** project
- **Google Cloud** OAuth client
- **Finnhub** API key (free tier)
- **FMP** / **Eulerpool** keys (optional — improve target accuracy)
- **Gemini** API key (optional — AI narratives)
- **Twilio** WhatsApp credentials (optional — daily briefing)
- **CRON_SECRET** (production cron auth)

---

## Local setup

### 1. Clone and install

```bash
git clone https://github.com/prakashshuklahub/stocklens.git
cd stocklens
npm install
```

### 2. Environment variables

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXTAUTH_URL` | Yes | `http://localhost:3000` in dev |
| `NEXTAUTH_SECRET` | Yes | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Yes | OAuth 2.0 Web client |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase API keys |
| `FINNHUB_API_KEY` | Yes | Recommendations & sentiment |
| `FMP_API_KEY` | No | Analyst targets (fallback chain) |
| `EULERPOOL_API_KEY` | No | Analyst targets (fallback chain) |
| `GEMINI_API_KEY` | No | AI narratives |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM` | No | WhatsApp briefing |
| `CRON_SECRET` | Prod | Cron route authorization |
| `DATABASE_URL` | No | For `scripts/migrate.mjs` only |

### 3. Database migrations

Run migrations in order via Supabase SQL Editor, or use `supabase/migrations/run_once_combined.sql` for a fresh project, then apply newer migrations (`010`–`019`) as needed.

```bash
# Optional CLI migrator
node scripts/migrate.mjs
```

### 4. Allow your Google account

```sql
INSERT INTO allowed_emails (email) VALUES ('you@gmail.com');
```

### 5. Google OAuth redirect URIs

- Origins: `http://localhost:3000` (+ production URL)
- Redirect: `http://localhost:3000/api/auth/callback/google` (+ production)

### 6. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with an allowed account.

### 7. Production build

```bash
npm run build
npm start
```

---

## Project structure

```
src/
├── app/
│   ├── (app)/              # watchlist, picks, portfolio, settings
│   ├── api/                # REST + cron routes
│   └── login/
├── components/
│   ├── AppNav.tsx          # Header + bottom tabs
│   ├── LiveRefreshHeader.tsx
│   ├── watchlist/          # Cards, search, tags, suggestions
│   ├── picks/              # Pick cards, loading states
│   ├── portfolio/          # Holdings, daily summary
│   └── settings/
├── hooks/                  # Market session, live price refresh
├── lib/
│   ├── auth.ts, supabase.ts
│   ├── live-prices.ts, market-hours.ts
│   ├── fundamentals-fetch.ts, load-fundamentals.ts
│   ├── picks-pipeline.ts, picks.ts, pick-narratives.ts
│   ├── portfolio-summary-*.ts, twilio/
│   └── llm.ts              # Gemini (optional)
supabase/migrations/
vercel.json                 # Cron schedules
```

---

## API routes (authenticated unless noted)

| Route | Purpose |
|-------|---------|
| `GET/POST /api/watchlist` | List / add watchlist |
| `PATCH/DELETE /api/watchlist/[ticker]` | Tags / remove |
| `GET /api/watchlist/search` | Yahoo ticker search |
| `GET /api/watchlist/suggestions` | Trending ideas |
| `POST /api/watchlist/suggestions/skip` | Dismiss a suggestion |
| `GET /api/fundamentals/batch` | Cache-first fundamentals for watchlist |
| `GET /api/fundamentals/[ticker]` | Single ticker fundamentals |
| `GET /api/signals` | Bullish / bearish / quiet for watchlist cards |
| `GET /api/picks` | Unified top-10 picks |
| `GET /api/picks/narratives` | Poll for LLM narrative updates |
| `GET /api/picks/headlines` | Headlines for pick cards |
| `GET /api/research/[ticker]` | Cached research panel data |
| `GET /api/chart/[ticker]` | Price chart series |
| `GET /api/portfolio` | Holdings + live prices |
| `POST /api/portfolio/sync` | Vested XLSX upload |
| `GET /api/portfolio/summary` | Daily AI portfolio summary |
| `GET /api/portfolio/signals/[ticker]` | Per-holding signal detail |
| `GET/PATCH /api/user/settings` | WhatsApp & preferences |
| `GET /api/cron/*` | Scheduled jobs (Bearer `CRON_SECRET`) |
| `GET /api/auth/*` | NextAuth |

---

## External services & limits

- **Yahoo Finance** — unofficial endpoints; app refreshes live prices every **13s** during US regular hours only.
- **Finnhub free tier** — recommendations & sentiment; paid-only endpoints avoided where possible.
- **Target chain** — StockAnalysis → FMP → Eulerpool → Finnhub → Yahoo; falls back to 52w high; cached until **5pm IST** daily reset.
- **Gemini** — optional; picks/portfolio/suggestions use sequential calls with delays to reduce 429s; narratives cached **3 hours**.
- **Twilio WhatsApp** — optional; one briefing per user per US trading day when opted in.
- **Not financial advice** — scoring and copy are informational.

---

## Deployment checklist

- [ ] All env vars set on Vercel (see `.env.example`)
- [ ] `NEXTAUTH_URL` matches production domain
- [ ] Google OAuth production redirect URIs
- [ ] Supabase migrations applied through latest (`019`+)
- [ ] Email(s) in `allowed_emails`
- [ ] `CRON_SECRET` set; `vercel.json` crons enabled on Pro/Hobby as applicable
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
| `npm run generate-icons` | PWA icon assets |
| `node scripts/migrate.mjs` | Apply SQL via `DATABASE_URL` |

---

## License

Private project — all rights reserved unless otherwise specified by the repository owner.
