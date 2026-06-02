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

- **One shared list for everyone** — up to **15** US stocks ranked nightly (not personalized to your watchlist).
- Built overnight by cron from `stock_fundamentals` + `stock_research_cache` (no live Yahoo during scoring).
- During the day, `/api/picks` overlays **live prices** so upside and buy zone stay current; if you hold a pick, portfolio size/cost is shown on the card.
- Each pick shows confidence, buy zone, analyst target, upside, factor chips, chart, vs-sector panel, and Key Research.
- Optional **Gemini** thesis + risk (cached ~3h; client polls `/api/picks/narratives`).
- See **[How Picks work](#how-picks-work)** below for the full scoring breakdown.

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
- `global_top_picks` / `global_top_picks_runs` — nightly ranked list (scoring v2 snapshot per run)
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
| `/api/cron/build-global-picks` | 17:00 Mon–Fri | Score universe → publish `global_top_picks` |
| `/api/cron/evaluate-global-picks` | 21:30 Mon–Fri | Track pick outcomes vs market (accuracy) |
| `/api/cron/send-picks-accuracy-report` | 14:00 Mon | Weekly accuracy email (opt-in) |

Configured in `vercel.json`.

---

## How Picks work

Stocklens Picks answers: *“Which US stocks look like strong buys right now, based on analyst targets, price action, news, fundamentals, and sector context?”*

Think of it as a **filter funnel**, then a **points contest**:

1. **Universe** — Every ticker in `stock_fundamentals` (thousands of names with cached data).
2. **Must-pass gates** — Strict rules; fail any rule and the stock is out (no partial credit).
3. **Scoring** — Survivors earn points for upside, analyst consensus, momentum, news, etc. Research and sector comparisons add or subtract within caps.
4. **Rank** — Sort by total score (tie-break: higher upside, then bigger move today).
5. **Publish** — Save top **15** to `global_top_picks` if at least **3** qualify; everyone sees the same list on the Picks tab.

Scoring runs in **`src/lib/picks-scoring-v2.ts`** (constants in `PICKS_V2_RULES`). Tune numbers there. Deeper architecture: [`docs/picks-architecture.md`](docs/picks-architecture.md) (some sections describe the older per-user pipeline; v2 global cron is the live path).

### When the list updates

| Step | What happens |
|------|----------------|
| Nightly cron | `build-global-picks` scores the full fundamentals table and writes today’s run |
| Your app open | `GET /api/picks` reads the latest **published** run from the DB |
| Market hours | Live Yahoo prices refresh **current price**, **upside %**, and **buy zone** on the card (rank/score factors stay from last night) |

### Must-pass gates (v2)

A stock only gets a score if **all** of these are true:

| Gate | Threshold |
|------|-----------|
| Share price | ≥ **$5** |
| Market cap | ≥ **$500M** (from research cache) |
| Analyst coverage | ≥ **8** analysts (buy + hold + sell) |
| Sell ratings | ≤ **35%** of analysts |
| Buy ratings | ≥ **50%** of analysts |
| Price target | **Analyst consensus only** (no momentum/52w synthetic targets) |
| Upside to target | ≥ **8%** above current price |
| News sentiment | If we have it: not negative (≥ **0**) |
| 30-day trend | If we have it: not down (≥ **0%**) |
| Earnings | **Excluded** if earnings are within **7** calendar days |
| Business quality | Profitable **or** revenue growing YoY (when research exists) |
| Minimum score | Total ≥ **35** points after bonuses |
| Confidence | Must be **high** only (≥ **15** analysts and **>60%** buy); medium/low picks are dropped |

### Scoring parameters (exact points)

Points stack. The UI **factor chips** mirror these labels.

#### Analyst upside (biggest lever)

| Upside to analyst target | Points |
|--------------------------|--------|
| ≥ 30% | **+44** |
| ≥ 15% | **+31** |
| ≥ 8% | **+13** |

#### Analyst buy consensus

| Buy ratio (buys ÷ all ratings) | Points |
|--------------------------------|--------|
| > 70% | **+25** |
| > 50% | **+15** |
| ≥ 50% (lean) | **+8** |

#### Price action & news

| Signal | Condition | Points |
|--------|-----------|--------|
| 14-day pullback | Between **−15%** and **−3%**, with upside still > 8% | **+12** |
| Good news tone | Sentiment > **0.3** | **+10** |
| Near 20-day support | Price within **3%** above support | **+8** |
| Near 52-week high | Price ≥ **97%** of 52w high **and** upside < **5%** | **−15** (penalty) |
| Volume spike | ≥ **1.5×** avg → +8; ≥ **2.0×** → **+12** | |
| Healthy volume band | **1.2×–2.0×** avg (not a spike) | **+4** |
| 7-day momentum | 7d change ≥ **+5%** | **+6** |
| Above 20-day average | Price ≥ 20d avg | **+5** |
| News buzz | ≥ **8** articles in 7 days | **+5** |
| Big move today | +2.5% → +8; +5% → +10; +8% → +12 (cap **+12** total) | |

#### Vs sector (sector ETF benchmark)

Uses relative strength vs the sector benchmark (e.g. XLK for Tech). Takes the **better** of RS score or price delta (not both):

| Signal | Condition | Points |
|--------|-----------|--------|
| Strong RS | RS score ≥ **65** | **+6** |
| Weak RS | RS score ≤ **35** | **−4** |
| Beating sector | 7d/30d delta vs ETF ≥ **+2%** | **+5** |
| Lagging sector | Delta ≤ **−2%** | **−3** |

#### Key research (fundamentals cache)

Total research adjustment is clamped to **±20** points (`PICKS_RESEARCH_RULES` in `src/lib/picks-research-scoring.ts`):

| Signal | Condition | Points |
|--------|-----------|--------|
| Revenue YoY | > **15%** / > **5%** / < **−10%** | **+8** / **+4** / **−6** |
| Profit margin | > **15%** / > **0%** / < **−20%** | **+6** / **+3** / **−8** |
| EPS YoY | > **10%** | **+5** |
| Debt / equity | < **1** / > **2.5** | **+4** / **−5** |
| Current ratio | > **1.5** | **+3** |
| Trailing P/E | **8–25** (reasonable) / ≥ **50** (stretched) | **+4** / **−4** |
| P/E vs sector median | ≤ **0.85×** / ≥ **1.5×** / ≥ **2.0×** | **+5** / **−6** / **−10** |
| Rich vs sector (v2 extra) | P/E **1.5×–2.0×** sector median | **−2** (within the ±20 cap) |

### Outputs on each pick card

| Field | Meaning |
|-------|---------|
| **Score** | Total points from the table above (from last nightly run) |
| **Confidence** | High / medium / low from analyst depth; v2 only publishes **high** |
| **Buy zone** | Suggested entry band from support vs current price |
| **Target** | Analyst consensus mean (low/high range when available) |
| **Upside** | % from current price (live) to target |
| **Factors** | Human-readable list of which rules fired |

**Not financial advice** — scores are mechanical rules on cached data, not buy recommendations.

### Code reference

| What | File |
|------|------|
| v2 gates, bonuses, ranking | `src/lib/picks-scoring-v2.ts` |
| Research points | `src/lib/picks-research-scoring.ts` |
| Vs-sector points | `src/lib/sector-relative-strength-scoring.ts` (`PICKS_VS_SECTOR_RULES`) |
| Nightly build | `src/lib/cron/build-global-picks.ts` |
| API response | `src/lib/global-picks-response.ts`, `src/app/api/picks/route.ts` |

Older **per-user** scoring (watchlist + portfolio + trending, top 10) still lives in `src/lib/picks-scoring.ts` for scripts/tests but is **not** what powers the Picks tab today.

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
| `GET /api/picks` | Global nightly top picks (live price overlay) |
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
