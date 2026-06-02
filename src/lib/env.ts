export const env = {
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET!,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL!,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY!,
  FINNHUB_API_KEY: process.env.FINNHUB_API_KEY!,
  // Optional. Analyst price targets via FMP (primary); skipped if unset.
  FMP_API_KEY: process.env.FMP_API_KEY ?? '',
  // Optional. Analyst price targets when FMP empty (1,000 req/month free).
  EULERPOOL_API_KEY: process.env.EULERPOOL_API_KEY ?? '',
  // Bearer token for /api/cron/refresh-targets (manual + Vercel cron).
  CRON_SECRET: process.env.CRON_SECRET ?? '',
  // Optional. If absent, /api/picks falls back to mechanical reasoning.
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
  // Optional. Twilio WhatsApp daily briefing — cron no-ops if unset.
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ?? '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ?? '',
  TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM ?? '',
  // Top Picks accuracy report — sent via Resend to admin only.
  PICKS_REPORT_EMAIL:
    process.env.PICKS_REPORT_EMAIL ?? 'prakashshukla1820@gmail.com',
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
  EMAIL_FROM: process.env.EMAIL_FROM ?? 'StockLens <onboarding@resend.dev>',
}
