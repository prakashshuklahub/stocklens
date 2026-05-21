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
}

export interface NarrativeOutput {
  thesis: string
  main_risk: string
  model: string
}

function systemPrompt(targetLabel: NarrativeInput['target_label']): string {
  const targetRule =
    targetLabel === 'analyst'
      ? 'The upside reference is the average 12-month Wall Street analyst price target.'
      : targetLabel === '52w_high'
        ? 'The target price is estimated from the 52-week high—not a bank forecast. Say "target price" if you mention it; you may note it is year-high based.'
        : 'The target price is estimated from recent momentum and analyst buy ratings—not an official bank forecast. Say "target price" if you mention it.'

  return `You are a sober equity analyst writing concise buy theses for everyday investors.

Rules you MUST follow:
- Write 2 to 3 sentences for the thesis. No more.
- Write 1 sentence for the main risk.
- Cite specific numbers from the data (e.g. "22 of 26 analysts rate buy", "+17% upside").
- Use plain English. Never mention API names, data vendors, or "free tier".
- Do NOT predict short-term prices. Do NOT say "will reach X by Y date".
- Do NOT use phrases like "moon", "rocket", "explode", or other hype.
- Do NOT recommend the user buy or sell — only describe why the data is interesting.
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
            maxOutputTokens: 240,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'object',
              properties: {
                thesis: { type: 'string' },
                main_risk: { type: 'string' },
              },
              required: ['thesis', 'main_risk'],
            },
          },
        }),
        cache: 'no-store',
      },
    )

    if (!res.ok) {
      console.warn(`[llm] ${model} ${res.status} for ${ticker}`)
      return null
    }

    const data = await res.json()
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return null

    // Schema mode should return clean JSON, but strip code fences defensively.
    let raw = text.trim()
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    }

    const parsed = JSON.parse(raw) as Partial<NarrativeOutput>
    if (typeof parsed.thesis !== 'string' || typeof parsed.main_risk !== 'string') return null

    return {
      thesis: parsed.thesis.trim(),
      main_risk: parsed.main_risk.trim(),
      model,
    }
  } catch (err) {
    console.warn(`[llm] ${model} failed for ${ticker}:`, err)
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

export interface SellReviewInput {
  ticker: string
  company_name: string | null
  severity: 'red' | 'watch'
  position_pnl_pct: number
  change_7d_pct: number | null
  change_30d_pct: number | null
  analyst_sell: number
  analyst_total: number
  factors: string[]
}

export interface SellReviewOutput {
  review_reason: string
  caveat: string
  model: string
}

const SELL_REVIEW_SYSTEM = `You help a patient long-term investor review a stock they already own.

Rules you MUST follow:
- review_reason: 2 sentences max. Explain why holding 1–3 more months may still be weak based ONLY on the data.
- caveat: 1 sentence. Remind them this is informational, not urgent advice to sell.
- NEVER say "sell now", "dump", "get out", or create panic.
- NEVER mention API names or data vendors.
- Cite specific numbers (position %, 30-day move, analyst counts).
- Plain text only. No markdown, no emojis.`

function buildSellReviewPrompt(input: SellReviewInput): string {
  const lines = [
    `Ticker: ${input.ticker} (${input.company_name ?? 'Unknown'})`,
    `Alert level: ${input.severity}`,
    `Position vs your average cost: ${input.position_pnl_pct.toFixed(1)}%`,
    `Analyst coverage: ${input.analyst_sell} sell of ${input.analyst_total} total`,
    `Matched concerns: ${input.factors.join(', ')}`,
  ]
  if (input.change_7d_pct != null) lines.push(`7-day change: ${input.change_7d_pct.toFixed(1)}%`)
  if (input.change_30d_pct != null) lines.push(`30-day change: ${input.change_30d_pct.toFixed(1)}%`)
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
            temperature: 0.35,
            maxOutputTokens: 220,
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

    let raw = text.trim()
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    }

    const parsed = JSON.parse(raw) as Partial<SellReviewOutput>
    if (typeof parsed.review_reason !== 'string' || typeof parsed.caveat !== 'string') return null

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

// ── Watchlist add suggestion (one calm sentence) ─────────────────────────────

export interface SuggestionBlurbInput {
  ticker: string
  analyst_consensus: 'strong buy' | 'buy' | 'mixed'
  mover_screen: 'day gainers' | 'most active'
  sector: string | null
  month_trend: string | null
  news_tone: string | null
  near_52w_high: boolean
}

export interface SuggestionBlurbOutput {
  reason: string
  model: string
}

const SUGGESTION_BLURB_SYSTEM = `You write one supplemental sentence under a stock suggestion card.

The card ALREADY shows: ticker, company name, price, today's % change, analyst buy ratio (X/Y), 30-day %, upside reference, and a headline. Do NOT repeat any of that.

Rules:
- Exactly 1 sentence, max 22 words.
- Add only NEW context: strong-buy vs buy quality (no X/Y counts), why it surfaced (day gainers / most active), sector angle, news tone, month trend, or 52-week-high caution.
- Never include: company name, ticker symbol, dollar price, percentages, or analyst fractions like 29/33.
- Use "strong buy" when analyst_consensus is strong buy.
- Sound informative, not hype. Never say "buy now", "moon", "worth tracking", or "don't miss".
- Plain text only. No markdown, no emojis.`

async function callGeminiSuggestionBlurb(
  model: string,
  user: string,
  ticker: string,
): Promise<SuggestionBlurbOutput | null> {
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
          systemInstruction: { parts: [{ text: SUGGESTION_BLURB_SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            temperature: 0.72,
            maxOutputTokens: 80,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'object',
              properties: { reason: { type: 'string' } },
              required: ['reason'],
            },
          },
        }),
        cache: 'no-store',
      },
    )

    if (!res.ok) return null
    const data = await res.json()
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return null

    let raw = text.trim()
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    }

    const parsed = JSON.parse(raw) as Partial<SuggestionBlurbOutput>
    if (typeof parsed.reason !== 'string' || !parsed.reason.trim()) return null

    return { reason: parsed.reason.trim(), model }
  } catch {
    return null
  }
}

export async function generateSuggestionBlurb(
  input: SuggestionBlurbInput,
): Promise<SuggestionBlurbOutput | null> {
  if (!isLLMEnabled()) return null

  const user = [
    `Ticker (do not mention in output): ${input.ticker}`,
    `Analyst consensus: ${input.analyst_consensus}`,
    `Surfaced on: ${input.mover_screen}`,
    input.sector ? `Sector: ${input.sector}` : '',
    input.month_trend ? `Month trend: ${input.month_trend}` : '',
    input.news_tone ? `News: ${input.news_tone}` : '',
    input.near_52w_high ? 'Near 52-week high: yes' : '',
  ]
    .filter(Boolean)
    .join('\n')

  const primary = await callGeminiSuggestionBlurb(PRIMARY_MODEL, user, input.ticker)
  if (primary) return primary
  return callGeminiSuggestionBlurb(FALLBACK_MODEL, user, input.ticker)
}
