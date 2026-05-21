#!/usr/bin/env node
/**
 * Run combined Supabase migration (stock_fundamentals + pick_narratives).
 *
 * Requires DATABASE_URL in .env.local — copy from:
 * Supabase Dashboard → Project Settings → Database → Connection string (URI)
 *
 * Usage: node scripts/migrate.mjs
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function loadEnv() {
  try {
    const raw = readFileSync(resolve(root, '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/)
      if (m) process.env[m[1].trim()] = m[2].trim()
    }
  } catch {
    /* ignore */
  }
}

loadEnv()

const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL
if (!url) {
  console.error(`
Missing DATABASE_URL in .env.local

Add your Postgres connection string from Supabase:
  Dashboard → Settings → Database → Connection string → URI

Example:
  DATABASE_URL=postgresql://postgres.[ref]:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres

Or paste supabase/migrations/run_once_combined.sql into the SQL Editor manually.
`)
  process.exit(1)
}

const files = ['run_once_combined.sql', '007_portfolio_sell_alerts.sql']
const sql = files
  .map((f) => readFileSync(resolve(root, 'supabase/migrations', f), 'utf8'))
  .join('\n\n')

const { default: pg } = await import('pg')
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()
  await client.query(sql)
  console.log('Migration OK:', files.join(', '))
} catch (err) {
  console.error('Migration failed:', err.message)
  process.exit(1)
} finally {
  await client.end()
}
