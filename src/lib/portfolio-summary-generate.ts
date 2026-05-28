import { fetchRegularSnapshotsForTickers } from '@/lib/live-prices'
import { loadFundamentalsCacheFirst } from '@/lib/load-fundamentals'
import {
  generatePortfolioBriefing,
  isLLMEnabled,
  type PortfolioBriefingHoldingInput,
} from '@/lib/llm'
import { MECHANICAL_MODEL } from '@/lib/narrative-cache'
import { loadFreshNarratives } from '@/lib/narrative-cache'
import { getUSMarketSession } from '@/lib/market-hours'
import { fetchHeadlinesForTickers } from '@/lib/pick-headlines'
import { scoreHoldingSignal } from '@/lib/portfolio-alert-scoring'
import {
  loadPortfolioSummaryRow,
  releaseSummaryLock,
  savePortfolioSummary,
  summaryTtlCutoff,
  tryAcquireSummaryLock,
} from '@/lib/portfolio-summary-cache'
import {
  BRIEFING_DO_NOT_REPEAT,
  buildHoldingEditorial,
  editorialTagsForPrompt,
  holdingRoleToday,
  portfolioDayTone,
} from '@/lib/portfolio-summary-editorial'
import { hashPortfolioHoldings } from '@/lib/portfolio-summary-hash'
import {
  mechanicalHoldingHeadline,
  mechanicalHoldingSummary,
  mechanicalPortfolioHeadline,
} from '@/lib/portfolio-summary-mechanical'
import {
  aggregatePortfolioSentiment,
  deriveSummaryTags,
  pickTopTags,
  sentimentFromMetrics,
  type SummaryTagInput,
} from '@/lib/portfolio-summary-tags'
import { loadResearchBatchFromDb } from '@/lib/stock-research-cache'
import type { createServerClient } from '@/lib/supabase'
import type {
  HoldingDailySummary,
  PortfolioDailySummaryPayload,
  PortfolioHolding,
  PortfolioSummarySentiment,
  PortfolioSummaryTag,
  SignalNewsItem,
  StockFundamentals,
  StockSnapshot,
} from '@/types'

type Supabase = ReturnType<typeof createServerClient>

type FundamentalsRow = StockFundamentals & { fetched_at?: string }

function minMaxIso(dates: (string | null | undefined)[]): { min: string | null; max: string | null } {
  const valid = dates.filter((d): d is string => Boolean(d))
  if (!valid.length) return { min: null, max: null }
  valid.sort()
  return { min: valid[0], max: valid[valid.length - 1] }
}

function computeDayPct(
  holdings: PortfolioHolding[],
  prices: Map<string, StockSnapshot>,
): number | null {
  let dayGain = 0
  let prevCloseValue = 0
  for (const h of holdings) {
    const snap = prices.get(h.ticker.toUpperCase())
    const price = snap?.price
    const d1 = snap?.change_1d_pct
    if (price == null || d1 == null) continue
    const prev = price / (1 + d1 / 100)
    dayGain += (price - prev) * h.quantity
    prevCloseValue += prev * h.quantity
  }
  if (prevCloseValue <= 0) return null
  return (dayGain / prevCloseValue) * 100
}

function trimBriefingInputs(
  inputs: PortfolioBriefingHoldingInput[],
): PortfolioBriefingHoldingInput[] {
  if (inputs.length <= 14) return inputs
  if (inputs.length <= 24) {
    return inputs.map((h) => ({
      ...h,
      editorial: {
        ...h.editorial,
        what_changed: null,
        material_updates: h.editorial.material_updates.slice(0, 4),
        key_metrics: h.editorial.key_metrics.slice(0, 3),
      },
    }))
  }
  const sorted = [...inputs].sort((a, b) => b.weight_pct - a.weight_pct)
  const cutoff = Math.ceil(sorted.length * 0.75)
  const full = sorted.slice(0, cutoff)
  const light = sorted.slice(cutoff).map((h) => ({
    ticker: h.ticker,
    company_name: h.company_name,
    weight_pct: h.weight_pct,
    role_today: h.role_today,
    signal_tier: h.signal_tier,
    suggested_tags: h.suggested_tags.slice(0, 2),
    editorial: {
      lead: h.editorial.lead,
      what_changed: null,
      catalyst: null,
      caution: null,
      material_updates: h.editorial.material_updates.slice(0, 2),
      key_metrics: h.editorial.key_metrics.slice(0, 2),
    },
    do_not_repeat: [...BRIEFING_DO_NOT_REPEAT],
  }))
  return [...full, ...light]
}

export async function regeneratePortfolioSummaryForUser(
  supabase: Supabase,
  userId: string,
): Promise<PortfolioDailySummaryPayload | null> {
  const { data: rows, error } = await supabase
    .from('portfolio_holdings')
    .select('*')
    .eq('user_id', userId)
    .order('ticker')

  if (error) {
    console.warn('[portfolio-summary] holdings load failed:', error.message)
    return null
  }

  const holdings = (rows ?? []) as PortfolioHolding[]
  if (!holdings.length) return null

  const holdingsHash = hashPortfolioHoldings(holdings)
  const tickers = holdings.map((h) => h.ticker.toUpperCase())
  const prices = await fetchRegularSnapshotsForTickers(tickers)
  const pricesAt = new Date().toISOString()

  const { fundamentals: fundamentalsRecord } = await loadFundamentalsCacheFirst(supabase, tickers)
  const { data: fdRows } = await supabase
    .from('stock_fundamentals')
    .select('ticker, fetched_at')
    .in('ticker', tickers)
  const fetchedAtByTicker = new Map<string, string>()
  for (const row of fdRows ?? []) {
    if (row.fetched_at) fetchedAtByTicker.set(String(row.ticker).toUpperCase(), row.fetched_at)
  }

  const researchMap = await loadResearchBatchFromDb(supabase, tickers)
  const { data: resRows } = await supabase
    .from('stock_research_cache')
    .select('ticker, fetched_at')
    .in('ticker', tickers)
  const researchFetched = (resRows ?? []).map((r) => r.fetched_at as string | null)

  const sellNarratives = await loadFreshNarratives<{ ticker: string; review_reason: string }>(
    supabase,
    'portfolio_sell_narratives',
    tickers.filter((t) => {
      const h = holdings.find((x) => x.ticker.toUpperCase() === t)
      if (!h) return false
      const price = prices.get(t)?.price ?? 0
      const scored = scoreHoldingSignal({
        holding: h,
        current_price: price,
        fundamentals: fundamentalsRecord[t] ?? null,
      })
      return scored.tier !== 'quiet'
    }),
    'portfolio-summary',
  )

  const headlinesByTicker = isLLMEnabled()
    ? await fetchHeadlinesForTickers(tickers, {
        limit: 3,
        companyNameByTicker: Object.fromEntries(
          holdings.map((h) => [h.ticker.toUpperCase(), h.company_name]),
        ),
      })
    : new Map<string, SignalNewsItem[]>()

  let totalValue = 0
  for (const h of holdings) {
    const p = prices.get(h.ticker.toUpperCase())?.price
    if (p != null) totalValue += p * h.quantity
  }

  const dayPct = computeDayPct(holdings, prices)
  const degradedTickers: string[] = []
  const holdingSummaries: HoldingDailySummary[] = []
  const briefingInputs: PortfolioBriefingHoldingInput[] = []
  const sentimentWeights: { sentiment: PortfolioSummarySentiment; weight_pct: number }[] = []
  const leaders: string[] = []
  const laggards: string[] = []

  for (const h of holdings) {
    const sym = h.ticker.toUpperCase()
    const snap = prices.get(sym)
    const price = snap?.price ?? null
    const d1 = snap?.change_1d_pct ?? null
    const f = (fundamentalsRecord[sym] ?? null) as FundamentalsRow | null
    const research = researchMap.get(sym) ?? null
    const invested = h.avg_cost_basis * h.quantity
    const currentValue = price != null ? price * h.quantity : null
    const pnlPct =
      currentValue != null && invested > 0 ? ((currentValue - invested) / invested) * 100 : null
    const weightPct = totalValue > 0 && currentValue != null ? (currentValue / totalValue) * 100 : 0

    const scored = scoreHoldingSignal({
      holding: h,
      current_price: price ?? 0,
      fundamentals: f,
    })

    const degraded = price == null || !f
    if (degraded) degradedTickers.push(sym)

    const tagInput: SummaryTagInput = {
      change_1d_pct: d1,
      change_7d_pct: f?.change_7d_pct ?? null,
      change_30d_pct: f?.change_30d_pct ?? null,
      position_pnl_pct: pnlPct,
      price,
      fundamentals: f,
      research,
      signal_tier: scored.tier,
    }
    const tags = deriveSummaryTags(tagInput)
    const sentiment = sentimentFromMetrics({
      change_1d_pct: d1,
      change_30d_pct: f?.change_30d_pct ?? null,
      position_pnl_pct: pnlPct,
      tags,
      signal_tier: scored.tier,
    })

    if (d1 != null && d1 >= 0.5) leaders.push(sym)
    if (d1 != null && d1 <= -0.5) laggards.push(sym)

    sentimentWeights.push({ sentiment, weight_pct: weightPct / 100 })

    const existingReview = sellNarratives.get(sym)?.review_reason ?? null

    const roleToday = holdingRoleToday(sym, weightPct, leaders, laggards)
    const editorial = buildHoldingEditorial({
      change_1d_pct: d1,
      change_7d_pct: f?.change_7d_pct ?? null,
      change_30d_pct: f?.change_30d_pct ?? null,
      tags,
      signal_tier: scored.tier,
      research,
      fundamentals: f,
      existing_review_reason: existingReview,
      role_today: roleToday,
      headlines: headlinesByTicker.get(sym) ?? [],
      price,
      position_pnl_pct: pnlPct,
      signal_factors: scored.factors,
    })

    briefingInputs.push({
      ticker: sym,
      company_name: h.company_name,
      weight_pct: Math.round(weightPct * 10) / 10,
      role_today: roleToday,
      signal_tier: scored.tier,
      suggested_tags: editorialTagsForPrompt(tags),
      editorial,
      do_not_repeat: [...BRIEFING_DO_NOT_REPEAT],
    })

    holdingSummaries.push({
      ticker: sym,
      company_name: h.company_name,
      sentiment,
      tags,
      summary: mechanicalHoldingSummary({
        ticker: sym,
        company_name: h.company_name,
        price,
        change_1d_pct: d1,
        change_30d_pct: f?.change_30d_pct ?? null,
        position_pnl_pct: pnlPct,
        analyst_buy: f?.analyst_buy ?? null,
        analyst_sell: f?.analyst_sell ?? null,
        analyst_total:
          (f?.analyst_buy ?? 0) + (f?.analyst_hold ?? 0) + (f?.analyst_sell ?? 0) || null,
        tags,
        sentiment,
        existing_review_reason: existingReview,
        degraded,
      }),
      headline: mechanicalHoldingHeadline({ ticker: sym, sentiment, change_1d_pct: d1, tags }),
      degraded_input: degraded,
    })
  }

  const fdMinMax = minMaxIso(tickers.map((t) => fetchedAtByTicker.get(t)))
  const resMinMax = minMaxIso(researchFetched)

  let portfolioSentiment = aggregatePortfolioSentiment(sentimentWeights)
  let portfolioHeadline = mechanicalPortfolioHeadline({
    portfolio_sentiment: portfolioSentiment,
    day_pct: dayPct,
    leaders,
    laggards,
  })

  let narrativeSource: 'llm' | 'mechanical' = 'mechanical'
  let model: string | null = MECHANICAL_MODEL

  if (isLLMEnabled()) {
    const trimmed = trimBriefingInputs(briefingInputs)
    const estimatedTokens = JSON.stringify(trimmed).length / 4
    if (estimatedTokens > 6000) {
      console.warn(`[portfolio-summary] token_budget fallback user=${userId} est=${Math.round(estimatedTokens)}`)
    } else {
      const llm = await generatePortfolioBriefing({
        day_tone: portfolioDayTone(dayPct),
        day_pct: dayPct,
        leaders: leaders.slice(0, 5),
        laggards: laggards.slice(0, 5),
        holding_count: holdings.length,
        holdings: trimmed,
      })

      if (llm) {
        narrativeSource = 'llm'
        model = llm.model
        portfolioHeadline = llm.portfolio_headline
        portfolioSentiment = llm.portfolio_sentiment

        const byTicker = new Map(llm.holdings.map((h) => [h.ticker.toUpperCase(), h]))
        for (let i = 0; i < holdingSummaries.length; i++) {
          const row = holdingSummaries[i]
          const llmRow = byTicker.get(row.ticker)
          if (!llmRow) continue
          const allowedTags = pickTopTags(
            llmRow.tags.filter((t): t is PortfolioSummaryTag =>
              (TAG_ALLOWLIST as readonly string[]).includes(t),
            ) as PortfolioSummaryTag[],
          )
          holdingSummaries[i] = {
            ...row,
            sentiment: llmRow.sentiment,
            tags: allowedTags.length ? allowedTags : row.tags,
            summary: llmRow.summary.slice(0, 340),
            headline: llmRow.headline ?? row.headline,
          }
        }
      }
    }
  }

  holdingSummaries.sort((a, b) => {
    const rank = (s: PortfolioSummarySentiment) =>
      s === 'negative' ? 0 : s === 'neutral' ? 1 : 2
    return rank(a.sentiment) - rank(b.sentiment) || a.ticker.localeCompare(b.ticker)
  })

  const payload: PortfolioDailySummaryPayload = {
    version: 1,
    generated_at: new Date().toISOString(),
    holdings_hash: holdingsHash,
    market_session: getUSMarketSession(),
    portfolio_headline: portfolioHeadline,
    portfolio_sentiment: portfolioSentiment,
    holdings: holdingSummaries,
    degraded_tickers: degradedTickers,
    inputs_as_of: {
      prices_at: pricesAt,
      fundamentals_age_min: fdMinMax.min,
      fundamentals_age_max: fdMinMax.max,
      research_age_min: resMinMax.min,
      research_age_max: resMinMax.max,
    },
    narrative_source: narrativeSource,
    model,
  }

  await savePortfolioSummary(supabase, userId, payload, holdingsHash, narrativeSource, model)
  return payload
}

const TAG_ALLOWLIST: PortfolioSummaryTag[] = [
  'earnings_beat',
  'earnings_miss',
  'earnings_soon',
  'target_raised',
  'target_cut',
  'weak_guidance',
  'strong_momentum',
  'weak_momentum',
  'analyst_upgrade',
  'analyst_downgrade',
  'heavy_sell_ratings',
  'strong_buy_ratings',
  'negative_news',
  'positive_news',
  'near_52w_high',
  'near_52w_low',
  'profit_target_reached',
]

export async function regenerateWithLock(
  supabase: Supabase,
  userId: string,
): Promise<PortfolioDailySummaryPayload | null> {
  const acquired = await tryAcquireSummaryLock(supabase, userId)
  if (!acquired) return null

  try {
    return await regeneratePortfolioSummaryForUser(supabase, userId)
  } catch (err) {
    console.warn('[portfolio-summary] regenerate failed:', err)
    await releaseSummaryLock(supabase, userId)
    return null
  }
}

export async function loadOrRefreshPortfolioSummary(
  supabase: Supabase,
  userId: string,
): Promise<{
  summary: PortfolioDailySummaryPayload | null
  stale: boolean
  refreshing: boolean
}> {
  const { data: holdings } = await supabase
    .from('portfolio_holdings')
    .select('ticker, quantity, avg_cost_basis')
    .eq('user_id', userId)

  if (!holdings?.length) {
    return { summary: null, stale: false, refreshing: false }
  }

  const hash = hashPortfolioHoldings(holdings as PortfolioHolding[])
  const row = await loadPortfolioSummaryRow(supabase, userId)
  const stale = !row || row.holdings_hash !== hash || row.generated_at < summaryTtlCutoff()

  if (!stale && row) {
    return { summary: row.payload, stale: false, refreshing: Boolean(row.is_regenerating) }
  }

  return {
    summary: row?.payload ?? null,
    stale: true,
    refreshing: Boolean(row?.is_regenerating),
  }
}
