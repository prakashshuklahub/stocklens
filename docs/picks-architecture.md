# Picks — architecture, data flow, and Key Research scoring

This document describes how **Picks cards** are built end-to-end in Stocklens: APIs, caches, cron jobs, scoring, and UI assembly. It also documents **Key Research** fetch/cache and how research metrics are **integrated into picks scoring** (DB read only — no live API on `/api/picks`).

**Status:** Research scoring, momentum target fixes, earnings exclusion, sector-relative P/E, and discovery cron coverage are **implemented** (see §10–12).

---

## Table of contents

1. [High-level overview](#1-high-level-overview)
2. [End-to-end request flow](#2-end-to-end-request-flow)
3. [Candidate universe](#3-candidate-universe)
4. [Data layers and caching](#4-data-layers-and-caching)
5. [Scoring algorithm (today)](#5-scoring-algorithm-today)
6. [Ranking and response shape](#6-ranking-and-response-shape)
7. [Pick card assembly (UI)](#7-pick-card-assembly-ui)
8. [Key Research — how it works today](#8-key-research--how-it-works-today)
9. [What picks uses vs what research stores](#9-what-picks-uses-vs-what-research-stores)
10. [Key Research in picks scoring (implemented)](#10-key-research-in-picks-scoring-implemented)
11. [Research rules reference](#11-research-rules-reference)
12. [Quality fixes (analyst review)](#12-quality-fixes-analyst-review)
13. [File map](#13-file-map)
14. [Cron schedule (Vercel)](#14-cron-schedule-vercel)
15. [API budget & Yahoo rate limits](#15-api-budget--yahoo-rate-limits)

---

## 1. High-level overview

**Picks** returns up to **10 ranked buy ideas** for the signed-in user. Candidates come from three sources, scored with **one shared formula**, then enriched with narratives and (client-side) headlines.

| Source tag (UI) | Origin |
|-----------------|--------|
| Watchlist | User's `watchlist_stocks` |
| Portfolio | User's `portfolio_holdings` (merged → `both` if also on watchlist) |
| Trending (`discovery`) | Global trending pool (quality-gated), excluding tickers the user already owns |

**Data inputs:** Picks scoring reads **`stock_fundamentals`** + live Yahoo quotes + sector benchmarks + **`stock_research_cache`** (batch DB read). Finnhub/FMP are never called from `/api/picks`.

```
┌─────────────┐     GET /api/picks      ┌──────────────────────┐
│ Picks page  │ ───────────────────────►│ buildUnifiedPicks    │
│ (client)    │                         │ Response (server)    │
└─────────────┘                         └──────────┬───────────┘
       │                                           │
       │  GET /api/picks/headlines                   │ Supabase read
       │  GET /api/picks/narratives (poll)          │ Yahoo live prices
       ▼                                           │ Fundamentals cache
┌─────────────┐                                    │ Research cache (DB)
│ PickCard UI │◄── merge on client ────────────────┘ Trending cache
└─────────────┘
```

---

## 2. End-to-end request flow

### Step 1 — `GET /api/picks`

**File:** `src/app/api/picks/route.ts`

1. Auth via NextAuth → `userId`
2. Optional `?refresh=1` forces fundamentals refresh **only during active price refresh window** (`isPriceRefreshActive()`)
3. Calls `buildUnifiedPicksResponse(supabase, userId, forceRefresh)`
4. Returns `PicksResponse` with `Cache-Control: private, no-store`

### Step 2 — `buildUnifiedPicksResponse`

**File:** `src/lib/picks-pipeline.ts`

Parallel load:

| Load | Source |
|------|--------|
| Watchlist | `watchlist_stocks` WHERE `user_id` |
| Portfolio | `portfolio_holdings` WHERE `user_id` |
| Sector benchmarks | `sector_benchmarks` (30 min TTL, shared) |
| Trending cache | `watchlist_suggestions_cache` key `global` (DB read; rebuild in background if empty/stale) |

Then:

1. **Build candidates** — dedupe watchlist + portfolio (`buildCandidates`)
2. **Discovery movers** — trending ranked list minus owned tickers
3. **Union tickers** — candidates + discovery tickers
4. **Load fundamentals + live prices** — `loadFundamentalsAndPrices()` (DB read for fundamentals; live Yahoo quotes batched + throttled)
5. **Load research batch** — `loadResearchBatchFromDb(allTickers)` + `computeSectorPeMedians()` (DB only)
6. **Score each candidate** — `scorePick()` with `researchContext`
7. **Score each discovery mover** — `scoreDiscoveryPick()` (extra pre-gates + research quality)
8. **Rank globally** — `rankAllPicks(scoredAll, 10)`
9. **Attach narratives** — cached `pick_narratives` + schedule async LLM if enabled
10. Return JSON
11. **After response** (`after()` in route) — background trending rebuild if needed; refresh stale fundamentals rows (same pattern as `/api/fundamentals/batch`)

### Step 3 — Client enrichment (non-blocking)

**File:** `src/app/(app)/picks/page.tsx`

| Request | When | Purpose |
|---------|------|---------|
| `GET /api/picks` | On page load | Scores, factors, prices, mechanical narratives |
| `GET /api/picks/headlines?tickers=…` | After picks load | Up to 5 headlines per pick (Google News RSS, 15 min in-memory cache) |
| `GET /api/picks/narratives?tickers=…` | If LLM enabled + mechanical fallback | Poll every 3s until LLM copy ready |

Headlines and LLM narratives **do not affect rank** — they only change card copy after the fact.

---

## 3. Candidate universe

### Your stocks

```typescript
// picks-pipeline.ts — buildCandidates()
watchlist → source: 'watchlist'
portfolio → source: 'portfolio' | 'both' (if ticker already on watchlist)
```

Sector is enriched from live quote or Yahoo if missing/`Other`.

### Trending picks (`discovery`)

1. **Trending pool** — `fetchTrendingCandidates(40)` → Yahoo screeners `day_gainers` + `most_actives` (`src/lib/market-movers.ts`)
2. **Scored & ranked** — `scoreTrendingCandidate()` → top 20 stored in global cache (`src/lib/trending-cache-build.ts`)
3. **Filtered per user** — remove tickers in user's watchlist ∪ portfolio
4. **Discovery pre-gates** before unified scoring (see [§5.4](#54-discovery-only-pre-gates-strong-movers))

---

## 4. Data layers and caching

Stocklens uses a **DB-first, cron-assisted, on-demand fallback** pattern. External APIs are never called unbounded from user requests.

### 4.1 `stock_fundamentals` (picks scoring input)

| Field group | Source | Refresh |
|-------------|--------|---------|
| 7d / 14d / 30d %, 52w high/low, support, avg_20d, volume_ratio | Yahoo 1y chart | 30 min TTL (`FUNDAMENTALS_CACHE_MINUTES`) |
| Analyst buy/hold/sell, news_sentiment, news_count_7d | Finnhub | Same row, same TTL |
| `target_price`, range, `target_source` | StockAnalysis → FMP → Finnhub → Yahoo → Eulerpool chain | Daily reset 5pm IST (`target_fetched_at`) |

**Loader:** `src/lib/load-fundamentals.ts`  
**Fetcher:** `src/lib/fundamentals-fetch.ts`  
**Cron:** `GET /api/cron/refresh-targets` — daily, batch 40 tickers, concurrency 3

Picks pipeline calls `loadFundamentalsCacheFirst()` on the hot path. Stale rows are refreshed **after the response** via `after()` (not blocking rank). Use `?refresh=1` during market hours for a synchronous refresh.

### 4.2 Live prices (scoring input for `% today`)

**File:** `src/lib/live-prices.ts`

- Yahoo v7 quote API — **50 symbols per request**, **150ms gap between chunks**
- Chart v8 fallback for missing symbols — **100ms gap**, sequential
- Used for `current_price`, `change_1d_pct`, session badge
- Fetched on every `/api/picks` run (not stored in DB) — intentional for live `% today`

### 4.3 `sector_benchmarks` (vs-sector scoring)

- 11 sector ETFs, 30 min TTL
- **File:** `src/lib/sector-benchmarks.ts`
- Regular-session 1d % only (no pre-market / after-hours prices)

### 4.4 `watchlist_suggestions_cache` (discovery pool)

- Key: `global`
- ~3h TTL (`NARRATIVE_TTL_HOURS`)
- Shared by watchlist suggestions UI and picks discovery
- **Never rebuilt synchronously on `/api/picks`** — if empty/stale, picks scores without discovery movers; `after()` triggers `rebuildTrendingCacheIfNeeded()` (`src/lib/trending-cache-schedule.ts`)

### 4.5 `pick_narratives` (card copy only)

| Setting | Value |
|---------|-------|
| TTL | 3 hours (`NARRATIVE_TTL_HOURS`) |
| LLM | Gemini when `GEMINI_API_KEY` set |
| Fallback | `mechanicalThesis()` — instant, no API |

**Async:** `schedulePickNarrativeGeneration()` fires after response; client polls `/api/picks/narratives`.

### 4.6 Headlines (card copy only)

- Google News RSS via `src/lib/news.ts`
- In-memory cache 15 min per ticker (`src/lib/pick-headlines.ts`)
- Not persisted in Supabase

### 4.7 `stock_research_cache` (Key Research — **picks scoring input**)

Batch-read on every `/api/picks` run via `loadResearchBatchFromDb()`. See [§8](#8-key-research--how-it-works-today) and [§10](#10-key-research-in-picks-scoring-implemented).

---

## 5. Scoring algorithm

**Files:** `src/lib/picks-scoring.ts`, `src/lib/picks-research-scoring.ts`

Constants: `PICKS_SCORING_RULES`, `PICKS_DISCOVERY_RULES`, `PICKS_VS_SECTOR_RULES`, `PICKS_RESEARCH_RULES`.

### 5.1 Hard gates (reject before points)

| Gate | Rule |
|------|------|
| Price | `current_price > 0` |
| **Earnings window** | **Hard exclude if earnings within 5 calendar days** (`research.earnings_date`) |
| Analyst coverage | ≥ 3 analysts total |
| Sell ratio | ≤ 50% sell |
| News sentiment | If present, ≥ −0.5 |
| Target | Must resolve positive upside (analyst / gated momentum / 52w high) |
| Min score | ≥ 20 after all bonuses |

### 5.2 Target resolution (required)

Order in `resolveTarget()`:

1. **Analyst target** — FMP/Eulerpool/legacy `target_mean` with positive upside
2. **Momentum target** — gated (§12.1): buy ≥ 45%, 30d > 5%, **synthetic upside capped at 20%**
3. **52-week high** — if price below high

No target → candidate excluded. See §12.1 for momentum quality gates by source.

### 5.3 Point buckets

| Category | Max impact (typical) |
|----------|----------------------|
| Upside to target | +10 to +35 |
| Analyst buy consensus | +6 to +20 |
| 14d pullback | +12 |
| News sentiment / buzz | +5 to +10 |
| Volume spike | +8 to +12 |
| 7d momentum, above 20d avg | +5 to +6 |
| Near support | +8 |
| Near 52w high + thin upside | **−15** |
| Vs sector (RS / price delta) | +5 to +6 or −3 to −4 |
| **Key research** (`applyResearchScore`) | **±20 max** — margins, growth, leverage, absolute P/E, **sector-relative P/E** |
| Big move today | +10 to +22 (≥ +2.5% day) |
| 30d trend | +6 to +12 |

### 5.4 Discovery-only pre-gates (trending)

Before `scoreUnifiedPick()`:

| Gate | Rule |
|------|------|
| Today's move | ≥ +2.5% |
| Fundamentals row | Must exist |
| Analysts | ≥ 5 |
| Buy ratio | ≥ 40% |
| **Research quality** | When research row exists: **profit margin > 0 OR revenue YoY > 0** |

Missing research row: pick can still qualify via **analyst or 52w target**, but **not momentum synthetic target** (§5.2).

### 5.5 Confidence badge (tie-breaker only)

| Level | Rule |
|-------|------|
| High | ≥ 15 analysts AND > 60% buy |
| Medium | ≥ 6 analysts AND > 50% buy |
| Low | else |

**Research confidence downgrade:** unprofitable with no trailing P/E → confidence lowered one tier.

Sort order in `rankAllPicks()`: score → confidence → upside % → today's change.

---

## 6. Ranking and response shape

```typescript
// types/index.ts — PicksResponse
{
  picks: Pick[]              // top 10 global
  your_picks: Pick[]         // picks where source !== 'discovery'
  discovery_picks: Pick[]    // source === 'discovery'
  scores_at: string
  narratives_at: string | null
  llm_enabled: boolean
  sector_benchmarks: Record<string, SectorBenchmark>
}
```

Each `Pick` includes: ticker, prices, changes, target fields, analyst counts, `score`, `factors[]`, `confidence`, `source`, optional `ownership`, narrative fields, optional `vs_sector`.

---

## 7. Pick card assembly (UI)

**File:** `src/app/(app)/picks/page.tsx` → `PickCard`

### Always visible (collapsed header)

- Rank badge, logo, ticker, confidence, source tag (Watchlist / Portfolio / Trending / etc.)
- Compact stats: buy zone, current price, room to grow, analyst buy count

### Accordion sections (all collapsed by default — Option A)

| Section | Data source |
|---------|-------------|
| Price & targets | Pick fields + `Week52Range` from fundamentals |
| Price chart | `GET /api/chart/[ticker]` — Yahoo on demand, not in DB |
| Key research | `GET /api/research/[ticker]` — **DB cache only on read** |
| Vs sector | `pick.vs_sector` + `sector_benchmarks` from picks response |
| Headlines | Merged from `/api/picks/headlines` |
| Why we picked this | Factors, analyst grid, thesis/risk (mechanical or LLM) |

**Key research affects rank** via `applyResearchScore()` (±20 pts, earnings gate, sector P/E). The accordion panel still loads the same cache row via `GET /api/research/[ticker]` for display.

---

## 8. Key Research — how it works today

### 8.1 Purpose

On-demand **fundamental snapshot** for UI: earnings date, P/E, margins, growth, balance-sheet ratios. Stored separately from `stock_fundamentals` because it comes from Finnhub `/stock/metric` (+ FMP gap-fill), not Yahoo candles.

### 8.2 Schema

**Migration:** `supabase/migrations/016_stock_research_cache.sql`

```sql
stock_research_cache (
  ticker PRIMARY KEY,
  earnings_date, ex_dividend_date,
  pe_trailing, pe_forward, market_cap, beta, dividend_yield_pct,
  revenue_growth_pct, earnings_growth_pct,
  gross_margin_pct, operating_margin_pct, profit_margin_pct,
  debt_to_equity, current_ratio,
  fetched_at
)
```

TypeScript: `StockResearchSnapshot` in `src/types/index.ts`.

### 8.3 Fetch pipeline

**File:** `src/lib/research-fetch.ts` → `fetchStockResearchFromApis(ticker)`

| Step | API | Notes |
|------|-----|-------|
| 1 | Finnhub `/stock/metric?metric=all` | Primary metrics |
| 2 | Finnhub `/stock/profile2` | Market cap, beta |
| 3 | Finnhub `/calendar/earnings` | Next earnings (12 mo window) |
| 4 | Finnhub `/stock/dividend` | Next ex-div date |
| 5 | FMP (if `FMP_API_KEY`) | `ratios-ttm`, `profile`, `financial-growth` — **field-level gap fill only** |

Returns `null` if no meaningful data.

### 8.4 Cache layer

**File:** `src/lib/stock-research-cache.ts`

| Constant | Value |
|----------|-------|
| `RESEARCH_TTL_MS` | 3 hours |
| On-demand dedupe | `onDemandInflight` Map (one fetch per ticker in flight) |

**Functions:**

| Function | Behavior |
|----------|----------|
| `loadResearchFromDb` | Read only |
| `upsertResearchToDb` | Write |
| `loadOrFetchResearch` | DB hit → return; miss → fetch APIs once → upsert |
| `ensureResearchForTicker` | Used on watchlist add (`onlyIfMissing`) |
| `loadResearchBatchFromDb` | Chunked `IN` query for picks pipeline (read only) |
| `listResearchTickerUniverse` | Watchlists + portfolio + fundamentals + **trending discovery tickers** |
| `sortResearchRefreshQueue` | missing → watchlist → **discovery pool** → oldest `fetched_at` |

### 8.5 API routes

| Route | Method | Behavior |
|-------|--------|----------|
| `/api/research/[ticker]` | GET | Read DB; fetch on miss if panel opened |
| `/api/research/[ticker]?force=1` | POST | Force refresh one ticker |
| `/api/cron/refresh-research` | GET | Cron batch refresh (Bearer `CRON_SECRET`) |

**UI:** `StockResearchPanel` → SWR → GET only (never calls Finnhub from browser).

### 8.6 Cron job

**File:** `src/lib/cron/refresh-research.ts`  
**Schedule:** `vercel.json` — `0 16 * * 1-5` UTC (9:30pm IST, Mon–Fri); skipped outside IST off-hours window

| Setting | Value |
|---------|-------|
| Batch size | 30 tickers/run |
| Gap between tickers | 300 ms (~Finnhub 60/min headroom) |
| Queue priority | Missing rows → watchlist → **discovery pool** → oldest stale |

**Universe:** watchlist + portfolio + `stock_fundamentals` + **trending discovery tickers** (from `watchlist_suggestions_cache`).

### 8.7 Bootstrap triggers

| Event | Action |
|-------|--------|
| User adds to watchlist | `POST /api/watchlist` → `ensureResearchForTicker(onlyIfMissing)` |
| User opens Key research panel | GET `/api/research/TICKER` → `loadOrFetchResearch` on cache miss |
| Daily cron | Refresh stale rows slowly |

### 8.8 Rate-limit strategy (current)

1. **Never** call Finnhub/FMP from picks scoring or picks API
2. **Always** read research from Supabase in user-facing GET
3. **Batch + sleep** in cron
4. **TTL 3h** — same row reused across all users (shared cache, not per-user)
5. **Inflight dedupe** — concurrent panel opens share one fetch
6. **FMP optional** — only when key set; used for gaps, not duplicate full pulls

---

## 9. What picks uses vs what research stores

| Metric | `stock_fundamentals` | `stock_research_cache` | Used in scoring? |
|--------|---------------------|------------------------|------------------|
| Price / 1d / 7d / 14d / 30d % | ✅ Yahoo | ❌ | Fundamentals |
| Analyst buy/hold/sell | ✅ Finnhub | ❌ | Fundamentals |
| Price target | ✅ Multi-source | ❌ | Fundamentals |
| News sentiment / count | ✅ Finnhub | ❌ | Fundamentals |
| Volume, support | ✅ Yahoo | ❌ | Fundamentals |
| P/E trailing | ❌ | ✅ Finnhub + FMP | **Research** (+ sector median) |
| Margins, Rev/EPS YoY | ❌ | ✅ | **Research** |
| Debt/equity, current ratio | ❌ | ✅ | **Research** |
| Earnings date | ❌ | ✅ Finnhub calendar | **Research** (5-day hard gate) |
| Ex-div, market cap, beta, div yield | ❌ | ✅ | UI only |

If research row is **missing**, scoring skips research bonuses/gates (except discovery momentum rules). Discovery cannot use **momentum synthetic target** without a cache row.

---

## 10. Key Research in picks scoring (implemented)

### 10.1 Pipeline (DB read only)

```typescript
const researchByTicker = await loadResearchBatchFromDb(supabase, allTickers)
const sectorPeMedians = computeSectorPeMedians(researchByTicker, sectorByTicker)

scorePick({
  researchContext: {
    research: researchByTicker.get(ticker) ?? null,
    sectorPeMedian: sectorPeMedianForTicker(sector, sectorPeMedians),
  },
})
```

### 10.2 Cron / cache coverage

- `listResearchTickerUniverse` unions **trending discovery tickers**
- `sortResearchRefreshQueue` prioritizes: missing → watchlist → discovery → oldest stale
- Still 30 tickers/run, 300ms gap — **zero** Finnhub/FMP on `/api/picks`

---

## 11. Research rules reference

**File:** `src/lib/picks-research-scoring.ts`

| Signal | Points |
|--------|--------|
| Rev YoY > 15% / 5–15% / < −10% | +8 / +4 / −6 |
| Profit margin > 15% / > 0% / < −20% | +6 / +3 / −8 |
| EPS YoY > 10% | +5 |
| Debt/equity < 1 / > 2.5 | +4 / −5 |
| Current ratio > 1.5 | +3 |
| P/E 8–25 / > 50 | +4 / −4 |
| P/E vs sector ≤ 0.85× / ≥ 1.5× / ≥ 2.0× median | +5 / −6 / −10 |

Total clamped **±20**. Dividend yield not scored (low priority).

---

## 12. Quality fixes (analyst review — implemented)

### 12.1 Momentum target leak

- Synthetic upside cap: **40% → 20%**
- Requires profitable **or** growing business when research exists
- Discovery without cache row: **no momentum target**

### 12.2 Earnings event risk

- **Hard exclude** earnings within **5 calendar days** (not a −3 pt penalty)

### 12.3 Sector-relative valuation

- Trailing P/E vs **sector median** from batch-loaded peers (min 3 tickers/sector)

### 12.4 Discovery cache warm-up

- Trending tickers in cron universe + queue priority

### 12.5 Optional next steps

- Post-picks background fetch for top discovery picks missing rows
- LLM narratives include research summary

---

## 13. File map

| Area | Files |
|------|-------|
| Picks API | `src/app/api/picks/route.ts` |
| Pipeline | `src/lib/picks-pipeline.ts` |
| Scoring | `src/lib/picks-scoring.ts`, `src/lib/picks-research-scoring.ts`, `src/lib/picks.ts` |
| Fundamentals | `src/lib/load-fundamentals.ts`, `src/lib/fundamentals-fetch.ts`, `src/lib/fundamentals-cache.ts` |
| Live prices | `src/lib/live-prices.ts` |
| Discovery pool | `src/lib/trending-candidates.ts`, `src/lib/market-movers.ts`, `src/lib/trending-cache-build.ts`, `src/lib/trending-cache-schedule.ts` |
| Sector | `src/lib/sector-benchmarks.ts`, `src/lib/sector-relative-strength.ts` |
| Narratives | `src/lib/pick-narratives.ts`, `src/lib/narrative-cache.ts`, `src/app/api/picks/narratives/route.ts` |
| Headlines | `src/lib/pick-headlines.ts`, `src/app/api/picks/headlines/route.ts` |
| Key research fetch | `src/lib/research-fetch.ts` |
| Key research cache | `src/lib/stock-research-cache.ts`, `src/app/api/research/[ticker]/route.ts` |
| Research cron | `src/lib/cron/refresh-research.ts`, `src/app/api/cron/refresh-research/route.ts` |
| Targets cron | `src/lib/cron/refresh-targets.ts`, `src/app/api/cron/refresh-targets/route.ts` |
| UI | `src/app/(app)/picks/page.tsx`, `src/components/StockResearchPanel.tsx` |
| Types | `src/types/index.ts` |
| DB | `supabase/migrations/004_stock_fundamentals.sql`, `006_picks.sql`, `016_stock_research_cache.sql` |

---

## 14. Cron schedule (Vercel)

**File:** `vercel.json` · **Window:** `src/lib/cron/window.ts` (IST)

**Off hours (no cron / background API work):** Mon–Fri 3:00am–2:59pm IST; all day Sat–Sun.

| Job | Path | Schedule (UTC) | IST (Mon–Fri) | Purpose |
|-----|------|----------------|---------------|---------|
| Refresh targets | `/api/cron/refresh-targets` | `30 15 * * 1-5` | 9:00pm | Analyst price targets → `stock_fundamentals` |
| Refresh research | `/api/cron/refresh-research` | `0 16 * * 1-5` | 9:30pm | Key research → `stock_research_cache` |
| Portfolio briefings | `/api/cron/refresh-portfolio-summaries` | `30 16 * * 1-5` | 10:00pm | Daily briefing cache (Gemini) |

Both require `Authorization: Bearer ${CRON_SECRET}`. Routes return `{ skipped: true }` if invoked inside the off-hours window.

**Hobby plan:** one run per cron per day (weekdays only). Background pick narratives and portfolio `after()` also respect the IST window.

---

## 15. API budget & Yahoo rate limits

Design goal: **never burst Yahoo from a single user-facing picks request**. Finnhub/FMP stay off the hot path; Yahoo is limited to live quotes (+ optional background work after response).

### Per-request budget on `GET /api/picks`

| Data | Hot path | Cached? | Yahoo calls (typical) |
|------|----------|---------|------------------------|
| Current price / 1d % | Live v7 quote | No | 1–2 batched requests (+ rare chart fallbacks) |
| 7d/14d/30d, 52w, volume | `stock_fundamentals` | Yes — 30 min TTL | **0** (DB read) |
| Analyst recs / news | `stock_fundamentals` | Same | **0** (Finnhub, already in row) |
| Price targets | `stock_fundamentals` | Daily 5pm IST | **0** on hot path |
| Sector RS | `sector_benchmarks` | 30 min DB + live ETF 1d | **0** on hot path (ETF overlay elsewhere) |
| Key research scoring | `stock_research_cache` | 3h TTL | **0** (Finnhub via cron only) |
| Discovery pool | `watchlist_suggestions_cache` | ~3h TTL | **0** on hot path |

### After response (`after()` in `src/app/api/picks/route.ts`)

| Task | When | Throttling |
|------|------|------------|
| Trending rebuild | Cache empty or past TTL | Deduped inflight lock; Yahoo screeners + fundamentals at concurrency 6 |
| Fundamentals refresh | Rows stale (>30 min) | `refreshFundamentalsForTickers` concurrency **3** |

### Yahoo-specific protections

| Endpoint | Module | Protection |
|----------|--------|------------|
| v7 `/quote` | `live-prices.ts` | 50 symbols/chunk, **150ms** between chunks, sequential chart fallbacks (**100ms** gap) |
| v8 `/chart` | `fundamentals-fetch.ts` | Only on refresh/cron paths; picks hot path avoids |
| v10 `quoteSummary` | `yahoo-session.ts` | Serialized queue, **400ms** gap, 429 cooldown **90s** |
| Screeners | `market-movers.ts` | Only in background trending rebuild — not on picks hot path |

### Finnhub / FMP

| Path | Protection |
|------|------------|
| `/api/picks` scoring | **Zero** live Finnhub/FMP |
| Research cron | 30 tickers/run, **300ms** gap |
| Fundamentals refresh | Concurrency **3** per batch |

### Force refresh

`?refresh=1` during `isPriceRefreshActive()` synchronously refreshes fundamentals for all candidate tickers (Yahoo chart + Finnhub). Use sparingly — normal loads rely on DB cache + background refresh.

---

## Summary

| Question | Answer |
|----------|--------|
| How is a pick card generated? | `/api/picks` → candidates → fundamentals + **research (DB)** + live prices → score → rank top 10 → narratives; client adds headlines |
| Does scoring use Key Research? | **Yes** — batch read from `stock_research_cache` (±20 pts, earnings gate, sector P/E) |
| How is Key Research fetched? | Finnhub (+ FMP gap-fill) → DB via cron, watchlist add, or panel GET on miss — **never on `/api/picks`** |
| Momentum target | Capped 20%; gated on business quality; blocked for discovery without cache |
| Earnings | Hard exclude within 5 days when date in cache |
| Yahoo on picks hot path | Live quotes only (batched + throttled); fundamentals/research/discovery from DB |
| Background work | `after()` — trending rebuild + stale fundamentals refresh |

Tune rules in `PICKS_RESEARCH_RULES` and `PICKS_SCORING_RULES.gates.momentumMaxUpsidePct`.
