<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:mobile-first-rules -->
# Mobile-First: This app must feel like a native iOS/Android app

Always optimise for mobile. Every UI change must be readable and feel native on a phone screen first.

## Required practices

- **Bottom tab navigation** — page-level nav belongs at the bottom (like Robinhood, Yahoo Finance). Never put route tabs in the top header.
- **Safe area insets** — always use `pb-[env(safe-area-inset-bottom)]` on fixed bottom bars and page footers. The viewport must include `viewport-fit=cover`.
- **Touch targets** — every tappable element must be at least 44×44 px (`w-11 h-11`). Always add `[touch-action:manipulation]` and `active:` states.
- **iOS input zoom prevention** — `<input>` font-size must be at least 16 px (`text-base`). Never use `text-sm` on a focusable input.
- **Tap highlight** — `-webkit-tap-highlight-color: transparent` is set globally in globals.css.
- **Content padding** — page `<main>` must have `pb-[calc(5rem+env(safe-area-inset-bottom,0px))]` when a fixed bottom nav is present.
- **Readable font sizes** — body text min `text-sm` (14px), labels min `text-xs` (12px). Never below 11px.
<!-- END:mobile-first-rules -->

<!-- BEGIN:data-ownership-rules -->
# Data Ownership: Per-User vs Shared

## Per-user (always scoped to `user_id`)
Every piece of user-generated or user-specific data **must** be scoped to the authenticated user. This includes:

- **Watchlist** — each user's list of tickers they follow
- **Portfolio holdings** — shares, avg cost, synced from Vested upload
- **Portfolio sync metadata** — `last_synced_at`, upload history
- **Picks / saved recommendations** — if a user saves or dismisses a pick

Always filter by `user_id` in queries. Always enforce RLS in Supabase so a user can never read another user's rows.

## Shared / common (no `user_id`)
Stock reference data that is the same for all users can be stored once and shared:

- **Stock metadata** — company name, sector, exchange, logo
- **Price targets** — analyst consensus targets, price levels
- **News articles** — fetched once, displayed to all users
- **AI pick signals** — the underlying signal/score for a ticker (not whether a specific user saved it)

These tables have no `user_id` column. They are read-only from the client and populated by server-side jobs or API routes.

## Rule of thumb
> "Would two different users ever have different values for this field for the same ticker?"
> - Yes → per-user table with `user_id`
> - No → shared table, no `user_id`
<!-- END:data-ownership-rules -->
