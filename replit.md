# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI**: OpenAI via Replit AI Integrations (gpt-5-mini)

## Artifacts

### stock-dashboard (/)
React + Vite frontend — live stock data dashboard ("StockPulse")
- Fetches real-time stock data from Yahoo Finance
- Shows: ticker, price, market cap, P/E ratio, quarterly report, events, price chart
- AI-generated summary per stock using OpenAI
- Dark terminal-style UI

### api-server (/api)
Express 5 REST API server
- `/api/stocks/:ticker` — full stock data + AI summary
- `/api/stocks/:ticker/summary` — standalone AI summary
- `/api/stocks/:ticker/history` — price history for charting

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Important Notes

- `lib/api-zod/src/index.ts` must only export from `./generated/api` (not `./generated/types` — causes name conflicts with Zod schemas)
- `lib/api-spec/orval.config.ts` — schemas option removed to avoid type/Zod name collision
- yahoo-finance2 v3 requires `new YahooFinance()` constructor call (default export)
- OpenAI integration uses Replit AI proxy (env: AI_INTEGRATIONS_OPENAI_BASE_URL, AI_INTEGRATIONS_OPENAI_API_KEY)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
