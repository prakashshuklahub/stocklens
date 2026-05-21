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
  // Optional. If absent, /api/picks falls back to mechanical reasoning.
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
}
