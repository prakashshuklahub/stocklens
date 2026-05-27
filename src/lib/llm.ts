// Thin Google Gemini client for generating pick narratives.
// Falls back gracefully if GEMINI_API_KEY is unset.
//
// Why Gemini: generous free tier, fast, supports strict JSON schema output.
// Primary model:  gemini-2.5-flash      (better quality)
// Fallback model: gemini-2.5-flash-lite (faster, used if Flash errors/rate-limits)

import { env } from '@/lib/env'

const PRIMARY_MODEL = 'gemini-2.5-flash'
const FALLBACK_MODEL = 'gemini-2.5-flash-lite'
export const LLM_PROVIDER = 'gemini'

export function isLLMEnabled(): boolean {
  return Boolean(env.GEMINI_API_KEY)
}

interface NarrativeInput {
  ticker: string
  company_name: string
  sector: string | null
  target_label: 'analyst' | '52w_high' | 'momentum'
  current_price: number
  target_mean: number
  target_low: number | null
  target_high: number | null
  upside_pct: number
  analyst_buy: number
  analyst_hold: number
  analyst_sell: number
  analyst_total: number
  change_7d_pct: number | null
  change_30d_pct: number | null
  week52_high: number | null
  week52_low: number | null
  news_sentiment: number | null
  factors: string[]
  recent_headlines: string[]
  /** Optional Yahoo business summary for richer company context. */
  business_summary?: string | null
}

export interface NarrativeOutput {
  company_blurb: string
  thesis: string
  main_risk: string
  model: string
}

/** Extract JSON object from Gemini output (schema mode usually clean; lite model sometimes adds prose). */
function parseJsonFromLlmText(raw: string): unknown | null {
  let text = raw.trim()
  if (!text) return null

  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  }

  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function systemPrompt(targetLabel: NarrativeInput['target_label']): string {
  const targetRule =
    targetLabel === 'analyst'
      ? 'The upside reference is the average 12-month Wall Street analyst price target.'
      : targetLabel === '52w_high'
        ? 'The target price is estimated from the 52-week high—not a bank forecast. Say "target price" if you mention it; you may note it is year-high based.'
        : 'The target price is estimated from recent momentum and analyst buy ratings—not an official bank forecast. Say "target price" if you mention it.'

  return `You are a sober equity analyst writing buy theses for everyday investors who may not follow markets daily.

Your job is to help someone understand what the company does, why the data looks interesting today, and what could go wrong — in plain English.

Rules you MUST follow:
- company_blurb: 2 to 3 sentences on what the company sells or does, who its customers are, and how it makes money (products, services, subscriptions, orders, deals, revenue drivers). Use the business summary when provided; do not invent specific dollar figures or contract names unless in the headlines.
- thesis: 4 to 5 sentences connecting the company's business to today's matched signals, momentum, analyst ratings, and headlines. Explain WHY the signals matter for this business — not a generic bull case. Cite exact numbers from the data.
- main_risk: 2 sentences on the most plausible downside for this specific company given sector, valuation, and the data — not generic "markets could fall" boilerplate.
- Use plain English. Never mention API names, data vendors, or "AI".
- Do NOT predict short-term prices. Do NOT say "will reach X by Y date".
- Do NOT use hype ("moon", "rocket", "explode"). Do NOT tell the user to buy or sell.
- ${targetRule}
- Plain text only. No markdown, no emojis.`
}

function buildUserPrompt(input: NarrativeInput): string {
  const targetLine =
    input.target_label === 'analyst'
      ? `Wall Street analyst target (12-month average): $${input.target_mean.toFixed(2)}` +
        (input.target_low && input.target_high
          ? ` (range $${input.target_low.toFixed(2)}–$${input.target_high.toFixed(2)})`
          : '')
      : input.target_label === '52w_high'
        ? `Target price (year-high basis): $${input.target_mean.toFixed(2)}`
        : `Estimated target price: $${input.target_mean.toFixed(2)}`

  const lines: string[] = [
    `Ticker: ${input.ticker} (${input.company_name})`,
    `Sector: ${input.sector ?? 'Unknown'}`,
    `Current price: $${input.current_price.toFixed(2)}`,
    targetLine,
    `Upside to reference: ${input.upside_pct.toFixed(1)}%`,
    `Analyst coverage: ${input.analyst_buy} buy / ${input.analyst_hold} hold / ${input.analyst_sell} sell (n=${input.analyst_total})`,
  ]
  if (input.change_7d_pct != null) lines.push(`7-day change: ${input.change_7d_pct.toFixed(1)}%`)
  if (input.change_30d_pct != null) lines.push(`30-day change: ${input.change_30d_pct.toFixed(1)}%`)
  if (input.week52_high && input.week52_low) {
    lines.push(`52-week range: $${input.week52_low.toFixed(2)}–$${input.week52_high.toFixed(2)}`)
  }
  if (input.news_sentiment != null) {
    lines.push(`News sentiment score: ${input.news_sentiment.toFixed(2)} (range -1 to +1)`)
  }
  lines.push(`Matched signals: ${input.factors.join(', ')}`)
  if (input.business_summary?.trim()) {
    lines.push(`Business summary (reference): ${input.business_summary.trim()}`)
  }
  if (input.recent_headlines.length) {
    lines.push('Recent headlines:')
    input.recent_headlines.slice(0, 3).forEach((h) => lines.push(`  - ${h}`))
  }
  return lines.join('\n')
}

// Single Gemini call with strict JSON output schema.
async function callGemini(
  model: string,
  system: string,
  user: string,
  ticker: string,
  attempt = 0,
): Promise<NarrativeOutput | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'object',
              properties: {
                company_blurb: { type: 'string' },
                thesis: { type: 'string' },
                main_risk: { type: 'string' },
              },
              required: ['company_blurb', 'thesis', 'main_risk'],
            },
          },
        }),
        cache: 'no-store',
      },
    )

    if (res.status === 429 && attempt < 2) {
      await sleep(1500 * (attempt + 1))
      return callGemini(model, system, user, ticker, attempt + 1)
    }

    if (!res.ok) {
      console.warn(`[llm] ${model} ${res.status} for ${ticker}`)
      return null
    }

    const data = await res.json()
    const finishReason: string | undefined = data?.candidates?.[0]?.finishReason
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return null

    if (finishReason === 'MAX_TOKENS') {
      console.warn(`[llm] ${model} truncated output for ${ticker}`)
    }

    const parsed = parseJsonFromLlmText(text) as Partial<NarrativeOutput> | null
    if (
      !parsed ||
      typeof parsed.company_blurb !== 'string' ||
      typeof parsed.thesis !== 'string' ||
      typeof parsed.main_risk !== 'string'
    ) {
      console.warn(`[llm] ${model} invalid JSON for ${ticker}: ${text.slice(0, 80)}…`)
      return null
    }

    return {
      company_blurb: parsed.company_blurb.trim(),
      thesis: parsed.thesis.trim(),
      main_risk: parsed.main_risk.trim(),
      model,
    }
  } catch (err) {
    console.warn(`[llm] ${model} failed for ${ticker}:`, err instanceof Error ? err.message : err)
    return null
  }
}

// Try Flash first, fall back to Flash Lite on any failure.
// Returns null if both fail or no API key is configured.
export async function generateNarrative(input: NarrativeInput): Promise<NarrativeOutput | null> {
  if (!isLLMEnabled()) return null

  const user = buildUserPrompt(input)

  const system = systemPrompt(input.target_label)
  const primary = await callGemini(PRIMARY_MODEL, system, user, input.ticker)
  if (primary) return primary

  console.warn(`[llm] ${input.ticker}: falling back to ${FALLBACK_MODEL}`)
  return callGemini(FALLBACK_MODEL, system, user, input.ticker)
}

// ── Portfolio sell review (conservative tone) ─────────────────────────────────

export interface SellReviewFactor {
  label: string
  value?: string
  tone: 'bullish' | 'bearish' | 'neutral'
}

export interface SellReviewInput {
  ticker: string
  company_name: string | null
  severity: 'red' | 'watch'
  score: number
  headline: string
  position_pnl_pct: number
  avg_cost_basis: number
  current_price: number
  quantity: number
  change_7d_pct: number | null
  change_14d_pct: number | null
  change_30d_pct: number | null
  analyst_buy: number
  analyst_hold: number
  analyst_sell: number
  analyst_total: number
  news_sentiment: number | null
  week52_high: number | null
  week52_low: number | null
  target_price: number | null
  support_20d: number | null
  negative_factors: SellReviewFactor[]
  positive_factors: SellReviewFactor[]
}

export interface SellReviewOutput {
  review_reason: string
  caveat: string
  model: string
}

const SELL_REVIEW_SYSTEM = `You write a clear portfolio review for someone who already owns this stock and is deciding whether to keep holding for the next 1–3 months.

Your job is to explain WHY the app flagged this position — connect the dots between their cost basis, recent price action, fundamentals, and analyst/news data so a non-expert understands the picture.

Rules for review_reason (4 to 6 sentences):
1. Open with their personal situation: average cost, current price, and P&L % in plain English.
2. Walk through EACH matched concern listed under "Concerns" — explain what it means in everyday language and cite the exact numbers provided (do not invent data).
3. If "Offsets" are listed, briefly acknowledge them and explain why concerns still outweigh them for a 1–3 month hold.
4. Close with a sober outlook: whether recent data supports a dependable recovery in the next quarter, or why patience may still be tested. Use "Review" severity as stronger language than "Watch" when alert level is red.
5. NEVER say "sell now", "dump", "get out", "cut losses immediately", or create panic.
6. NEVER mention API names, data vendors, or "AI".
7. Plain text only. No markdown, bullet characters, or emojis.

Rules for caveat (1 sentence):
- Remind them this is an informational review to support their own decision—not urgent trading advice.`

function formatReviewFactors(factors: SellReviewFactor[]): string {
  if (!factors.length) return '  (none)'
  return factors
    .map((f) => (f.value ? `  - ${f.label}: ${f.value}` : `  - ${f.label}`))
    .join('\n')
}

function buildSellReviewPrompt(input: SellReviewInput): string {
  const lines: string[] = [
    `Ticker: ${input.ticker} (${input.company_name ?? 'Unknown'})`,
    `Alert level: ${input.severity} (internal score ${input.score})`,
    `Summary headline: ${input.headline}`,
    '',
    'Your position:',
    `  Shares: ${input.quantity}`,
    `  Average cost: $${input.avg_cost_basis.toFixed(2)}`,
    `  Current price: $${input.current_price.toFixed(2)}`,
    `  P&L vs your cost: ${input.position_pnl_pct >= 0 ? '+' : ''}${input.position_pnl_pct.toFixed(1)}%`,
    '',
    'Price trends:',
  ]
  if (input.change_7d_pct != null) lines.push(`  7-day: ${input.change_7d_pct.toFixed(1)}%`)
  if (input.change_14d_pct != null) lines.push(`  14-day: ${input.change_14d_pct.toFixed(1)}%`)
  if (input.change_30d_pct != null) lines.push(`  30-day: ${input.change_30d_pct.toFixed(1)}%`)

  lines.push(
    '',
    `Analyst ratings: ${input.analyst_buy} buy / ${input.analyst_hold} hold / ${input.analyst_sell} sell (n=${input.analyst_total})`,
  )

  if (input.news_sentiment != null) {
    lines.push(`News sentiment score: ${input.news_sentiment.toFixed(2)} (scale roughly -1 to +1; negative = bearish tone)`)
  }
  if (input.week52_low != null && input.week52_high != null) {
    lines.push(`52-week range: $${input.week52_low.toFixed(2)}–$${input.week52_high.toFixed(2)}`)
  }
  if (input.target_price != null) {
    const vsTarget = ((input.current_price - input.target_price) / input.target_price) * 100
    lines.push(
      `Reference target price: $${input.target_price.toFixed(2)} (current price is ${vsTarget >= 0 ? '+' : ''}${vsTarget.toFixed(0)}% vs this reference)`,
    )
  }
  if (input.support_20d != null) {
    lines.push(`Recent 20-day support level: $${input.support_20d.toFixed(2)}`)
  }

  lines.push('', 'Concerns (explain each in review_reason):', formatReviewFactors(input.negative_factors))
  lines.push('', 'Offsets (mention if relevant):', formatReviewFactors(input.positive_factors))

  return lines.join('\n')
}

async function callGeminiSellReview(
  model: string,
  user: string,
  ticker: string,
): Promise<SellReviewOutput | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SELL_REVIEW_SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            temperature: 0.45,
            maxOutputTokens: 520,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'object',
              properties: {
                review_reason: { type: 'string' },
                caveat: { type: 'string' },
              },
              required: ['review_reason', 'caveat'],
            },
          },
        }),
        cache: 'no-store',
      },
    )

    if (!res.ok) {
      console.warn(`[llm/sell] ${model} ${res.status} for ${ticker}`)
      return null
    }

    const data = await res.json()
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return null

    const parsed = parseJsonFromLlmText(text) as Partial<SellReviewOutput> | null
    if (!parsed || typeof parsed.review_reason !== 'string' || typeof parsed.caveat !== 'string') return null

    return {
      review_reason: parsed.review_reason.trim(),
      caveat: parsed.caveat.trim(),
      model,
    }
  } catch (err) {
    console.warn(`[llm/sell] ${model} failed for ${ticker}:`, err)
    return null
  }
}

export async function generateSellReview(input: SellReviewInput): Promise<SellReviewOutput | null> {
  if (!isLLMEnabled()) return null
  const user = buildSellReviewPrompt(input)
  const primary = await callGeminiSellReview(PRIMARY_MODEL, user, input.ticker)
  if (primary) return primary
  return callGeminiSellReview(FALLBACK_MODEL, user, input.ticker)
}
