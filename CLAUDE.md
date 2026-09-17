# CareCompanion — notes for AI co-builders

- **Stack:** Node 24 on Render (`engines >=22.19`), TypeScript ESM with `NodeNext` (relative imports need `.js` suffixes), Express 5, MCP SDK v2 split packages (`@modelcontextprotocol/server|node|express|client`), `@modelcontextprotocol/ext-apps` 2.0 for the MCP App view, Vite 6 + React 19 in `ui/` and `web/`, vitest, Bedrock Converse (Claude Haiku 4.5) only behind `/api/agent`.
- **Commands:** `npm run dev` (server with tsx watch) · `npm run dev:web` (Vite, proxies /api and /mcp to :3000) · `npm run build` (server + ui + web) · `npm test` · `npm run typecheck` (three TS projects) · `npm run lint` · `npm run format` · `npm start` · `npm run mcp:lifecycle` · `npm run agent:smoke` · `npm run skill:validate`.
- **Local run for manual checks:** `PORT=3100 AGENT_BRAIN=rules DEMO_RESET_TOKEN=demo SEED_ON_BOOT=always node dist/server/main.js` (port 3000 may be taken on the dev Mac); MCP App host: `cd ~/src/ext-apps/examples/basic-host && SERVERS='["http://localhost:3100/mcp"]' <repo>/node_modules/.bin/tsx serve.ts` → http://localhost:8080.
- **Auth:** `/mcp` is open unless `MCP_AUTH=client_credentials` (+ `MCP_CLIENT_ID`, `MCP_CLIENT_SECRET`, `PUBLIC_URL`); see `src/http/authRoutes.ts`. Keep the 401 response free of `WWW-Authenticate` (Alexa+ checklist).
- **Conventions:** Prettier (2 spaces, single quotes, 120 cols, es5 trailing commas); ESLint flat config; domain logic is pure functions under `src/domain`; **no LLM call inside any MCP tool/resource/prompt handler** (tools stay in-memory, < 50 ms); every tool returns voice-first `content[0].text` plus `structuredContent`.
- **Logging:** in stdio mode (`src/bin/stdio.ts`) never write to stdout — the logger writes to stderr.
- **Time:** store UTC ISO strings; compute "today" in `HOUSEHOLD_TZ` via `src/domain/time.ts`.
- **Secrets:** never commit `.env`; AWS keys live only in Render env vars or the local AWS profile; `BEDROCK_REGION` is pinned explicitly.
- **Plan of record:** `~/.claude/plans/hidden-churning-sun.md` (build order M0–M9, feature freeze Oct 12, Devpost submit Oct 20).
