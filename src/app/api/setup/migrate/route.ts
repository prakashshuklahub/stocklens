/**
 * One-time migration runner (dev only).
 * Visit: http://localhost:3000/api/setup/migrate
 * Requires DATABASE_URL in .env.local (Supabase → Database → Connection string URI)
 */

import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { resolve } from 'path'

export const runtime = 'nodejs'

const MIGRATION_FILES = [
  '004_stock_fundamentals.sql',
  '005_news_sentiment.sql',
  '006_picks.sql',
  '007_portfolio_sell_alerts.sql',
  '008_watchlist_suggestions_cache.sql',
  '010_target_price_cache.sql',
  '011_eulerpool_target_source.sql',
  '012_stockanalysis_target_source.sql',
  '018_portfolio_daily_summaries.sql',
  'run_once_combined.sql',
]

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL
  if (!url) {
    return NextResponse.json({
      error: 'Missing DATABASE_URL',
      help: [
        'Supabase Dashboard → Project Settings → Database → Connection string → URI',
        'Add to .env.local: DATABASE_URL=postgresql://postgres.[ref]:[PASSWORD]@...',
        'Restart npm run dev, then open this URL again.',
        'Or paste supabase/migrations/run_once_combined.sql into SQL Editor.',
      ],
    }, { status: 400 })
  }

  try {
    const { default: pg } = await import('pg')
    const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
    await client.connect()

    const ran: string[] = []
    for (const file of MIGRATION_FILES) {
      const sql = readFileSync(
        resolve(process.cwd(), 'supabase/migrations', file),
        'utf8',
      )
      await client.query(sql)
      ran.push(file)
    }

    await client.end()

    return NextResponse.json({
      ok: true,
      message: 'Migrations applied. Refresh Picks — caching will work now.',
      files: ran,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
