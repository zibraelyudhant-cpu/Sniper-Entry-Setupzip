# Sniper Entry Setup

Crypto trading mobile app with top-down SMC (Smart Money Concepts) analysis. Menu 1 is a live futures screener; tap any coin to run a full D1→H4→H1→15M→5M sniper entry analysis.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port dynamic)
- `pnpm --filter @workspace/mobile run dev` — run the Expo mobile app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + Binance Futures REST API (no key needed for public endpoints)
- Mobile: Expo (React Native) with expo-router, @tanstack/react-query
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle for API)

## Where things live

- `artifacts/api-server/src/lib/smc.ts` — all SMC analysis logic (OB, FVG, S&R, SnD, Fibonacci, ATR, RSI)
- `artifacts/api-server/src/routes/screener.ts` — GET /api/screener
- `artifacts/api-server/src/routes/smc-analysis.ts` — GET /api/smc-analysis?symbol=BTCUSDT
- `artifacts/mobile/app/(tabs)/index.tsx` — Menu 1: Screener
- `artifacts/mobile/app/(tabs)/sniper.tsx` — Menu 2: Sniper Entry Setup
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contracts)

## Architecture decisions

- Binance Futures public API (fapi.binance.com) — no API key required for klines, tickers, funding rates, OI
- Top-down SMC analysis: D1+H4 trend confirmation → H1 zone detection (7-tier hierarchy) → 15M refine → 5M confirmation → SL/TP calc
- Zone hierarchy: Unfilled Order in OB > OB+FVG > OB+S&R > OB pure > FVG+S&R > FVG pure > S&R+Fib
- Skip conditions checked: RSI divergence, volume trend, OI change, funding rate extremes
- Sniper screen reads `symbol` param from URL — screener navigates here automatically

## Product

- **Menu 1 (Screener)**: Live list of top 20 futures pairs sorted by volume, D1 bias badge, 24h change, price. Tap any coin → auto-runs analysis.
- **Menu 2 (Sniper Entry Setup)**: Full SMC analysis. Returns status: `ready` (shows entry/SL/TP), `no_trend`, `no_zone`, `skip_conditions`, or `error`.

## User preferences

- No auto-execution — all output is reference only
- Indonesian language for labels and messages
- Dark trading terminal aesthetic

## Gotchas

- Binance Futures endpoint: `fapi.binance.com` (not `api.binance.com`)
- After any OpenAPI spec change, run codegen before touching mobile screens
- SL never tighter than 1× ATR H1 from entry (enforced in `calcSniperLevels`)
