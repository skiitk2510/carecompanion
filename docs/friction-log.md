# Friction log

Running log of friction hit while building CareCompanion for the Alexa+ track, kept from day 1 in the format the hackathon asks for. Newest entries at the bottom. Severity: **blocker** / **high** / **medium** / **low**.

---

## FL-01 · The quickstart handler answers GET/DELETE with 405 — sessionful serving lives in an example

- **Date:** 2026-09-16 · **Tool:** `@modelcontextprotocol/server` 2.0.0 (`createMcpHandler`) · **Severity:** high
- **Task:** Stand up a Streamable HTTP (spec 2025-11-25) endpoint that an Alexa+-style client can drive through a full session lifecycle (POST initialize → GET stream → DELETE).
- **Steps:** Followed the top-level server docs to `createMcpHandler(...)`. Read the handler's `legacy` option: the default `legacy: 'stateless'` mode serves 2025-11-25 clients but has no session, so `GET` and `DELETE /mcp` return **405**.
- **Expectation vs reality:** Expected the documented default to satisfy the 2025-11-25 lifecycle the hackathon requires. Reality: the sessionful pattern (`NodeStreamableHTTPServerTransport` + `sessionIdGenerator` + a session map) is only shown in `examples/legacy-routing/server.ts` inside the SDK repo, not on the package README.
- **Workaround:** Hand-wired the session map exactly as the example does (`src/http/mcpRoutes.ts`) and wrote `scripts/mcp-lifecycle.sh` to prove every verb.
- **Suggestion:** Surface a `createSessionfulMcpHandler()` (or a `legacy: 'sessionful'` mode) in the package, and put "GET/DELETE → 405 in stateless mode" in the `createMcpHandler` docstring where people will see it before they deploy.

## FL-02 · Which split package exports which symbol is not discoverable

- **Date:** 2026-09-16 · **Tool:** MCP TypeScript SDK v2 split packages (`server` / `node` / `express` / `client`) · **Severity:** medium
- **Task:** Import `NodeStreamableHTTPServerTransport`, `isInitializeRequest`, `createMcpExpressApp`, `StdioServerTransport`, `StreamableHTTPClientTransport`.
- **Steps:** Searched the published `.d.ts` files — the packages ship `.d.mts`/`.d.cts` under `dist/`, so a naive `*.d.ts` grep found nothing; ended up reading the SDK example's import lines to learn the package-to-symbol map (`StdioServerTransport` is on the `@modelcontextprotocol/server/stdio` subpath, not the root).
- **Expectation vs reality:** Expected a "what moved where" table in the migration notes. Reality: the mapping had to be reverse-engineered from an example file.
- **Workaround:** Recorded the map in `CLAUDE.md`; import paths are now pinned in code.
- **Suggestion:** Add a symbol → package/subpath index to the v2 migration guide and to each package README.

## FL-03 · The DNS-rebinding warning fires even when you scope protection yourself

- **Date:** 2026-09-16 · **Tool:** `@modelcontextprotocol/express` 2.0.0 (`createMcpExpressApp`) · **Severity:** low
- **Task:** Bind `0.0.0.0` on Render, guard `/mcp` with `hostHeaderValidation`, but leave `/healthz` open for the platform health checker (whose `Host` header is not the public hostname).
- **Steps:** `createMcpExpressApp({ host: '0.0.0.0' })` plus `app.use('/mcp', hostHeaderValidation([...]))`. On boot the SDK prints `Warning: Server is binding to 0.0.0.0 without DNS rebinding protection…` because its automatic guard is app-wide and the only way to enable it is `allowedHosts`, which would also 403 the health check.
- **Expectation vs reality:** Expected a way to say "I have applied the middleware on the MCP route". Reality: a permanent boot warning in production logs that judges/operators will read as a misconfiguration.
- **Workaround:** Documented it in the README; the route-scoped guard is covered by a test (`test/mcp/lifecycle.test.ts`, foreign-Host case).
- **Suggestion:** Let `createMcpExpressApp` accept `allowedHosts` with a `paths: ['/mcp']` scope, or expose `dnsRebindingProtection: 'manual'` to acknowledge the warning.

## FL-04 · `fetch()` cannot send a custom `Host` header, so the guard is awkward to test

- **Date:** 2026-09-16 · **Tool:** Node 22+ `fetch` (undici) vs `hostHeaderValidation` · **Severity:** low (general ecosystem, not Amazon/MCP-specific)
- **Task:** Assert that `/mcp` returns 403 for a foreign `Host` header.
- **Steps:** Wrote the test with `fetch()`; the header was silently dropped and the request was allowed (200).
- **Workaround:** A 20-line `node:http` helper (`test/helpers/testServer.ts`, `rawRequest`).
- **Suggestion:** The SDK's own test utilities could ship a tiny raw-request helper next to the validation middlewares.

## FL-05 · Fresh `npm install` resolves TypeScript 6 / ESLint 10, which `typescript-eslint` 8 does not support

- **Date:** 2026-09-16 · **Tool:** general TypeScript toolchain · **Severity:** low (general ecosystem)
- **Steps:** `npm i -D typescript eslint typescript-eslint` pulled TS 6.0 and ESLint 10; typescript-eslint 8.70 declares support for `<6.0` TS and ESLint 9.
- **Workaround:** Pinned `typescript@^5.9`, `eslint@^9`, `@eslint/js@^9`.
