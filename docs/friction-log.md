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

## FL-06 · `outputSchema` violations surface only at runtime, without the tool name or key path

- **Date:** 2026-09-16 · **Tool:** `@modelcontextprotocol/server` 2.0.0 (`registerTool` with zod `outputSchema`) · **Severity:** medium
- **Task:** Return `structuredContent` for `get_todays_plan` whose dose objects carry a `scheduledAt` field.
- **Steps:** The zod → JSON Schema conversion emits `additionalProperties: false`; the SDK validates `structuredContent` _after_ the handler ran and answered the client with `must NOT have additional properties`. Nothing named the tool or the offending key, and `tsc` could not catch it because the handler's return type is `Record<string, unknown>` rather than the schema's inferred type.
- **Expectation vs reality:** Expected a compile-time mismatch (the whole point of declaring the schema in TypeScript). Reality: a generic runtime string found by an integration test.
- **Workaround:** Declared every emitted key in the schema (`src/mcp/schemas.ts`) and kept an SDK-client test per tool so drift fails CI.
- **Suggestion:** Type the handler's `structuredContent` as `z.infer<typeof outputSchema>` in `registerTool`, and include `tool name + instancePath` in the validation error message.

## FL-07 · Hand-typed tool results don't satisfy `registerTool` (index signature), with a 30-line overload error

- **Date:** 2026-09-16 · **Tool:** `@modelcontextprotocol/server` 2.0.0 / `@modelcontextprotocol/ext-apps` `registerAppTool` · **Severity:** low
- **Steps:** Wrote a small `ToolOutcome` interface (`content`, `structuredContent`, `isError`) for a shared error-mapping helper. Both `registerTool` and `registerAppTool` rejected it: `Index signature for type 'string' is missing`, buried under two overload explanations.
- **Workaround:** Return the SDK's exported `CallToolResult` type instead (`src/mcp/result.ts`).
- **Suggestion:** Mention in the `registerTool` docs that helper functions should return `CallToolResult`, and consider dropping the deprecated raw-shape overload so the error points at the real cause.

## FL-08 · Bedrock model access status is only discoverable through an obscure API field

- **Date:** 2026-09-16 · **Tool:** Amazon Bedrock (`get-foundation-model-availability`) · **Severity:** low
- **Task:** Find out, before spending, whether the account can invoke Claude Haiku 4.5 in us-east-1.
- **Steps:** `list-foundation-models` lists the model regardless of access. `get-foundation-model-availability` returned `authorizationStatus: AUTHORIZED`, `entitlementAvailability: AVAILABLE`, `regionAvailability: AVAILABLE` but `agreementAvailability.status: NOT_AVAILABLE` — which reads like "not available here" when it actually means "the model-use agreement has not been accepted in the console".
- **Workaround:** Documented the check and its meaning in the README's AWS setup notes.
- **Suggestion:** Name the state `AGREEMENT_NOT_ACCEPTED` (with a console deep link), and surface the same status in `list-foundation-models`.

## FL-09 · Two different names for the same Bedrock prerequisite: "agreement" vs "use case details form"

- **Date:** 2026-09-16 · **Tool:** Amazon Bedrock (Converse API, Anthropic models) · **Severity:** medium
- **Task:** First real `ConverseCommand` to `us.anthropic.claude-haiku-4-5-20251001-v1:0` in us-east-1 from a fresh account.
- **Steps:** The availability API (FL-08) reported `agreementAvailability: NOT_AVAILABLE`. The runtime then failed with `ResourceNotFoundException: Model use case details have not been submitted for this account. Fill out the Anthropic use case details form before using the model. If you have already filled out the form, try again in 15 minutes.`
- **Expectation vs reality:** Expected one consistent prerequisite ("enable model access") with one name and one error type. Reality: a `ResourceNotFoundException` (which usually means "wrong model id") for a missing form, a different word ("agreement") in the availability API, and a 15-minute propagation delay nobody mentions up front.
- **Workaround:** The app treats `ResourceNotFoundException` as "Bedrock unusable", pauses Bedrock for five minutes and answers with the rule-based brain, so the demo keeps working (`src/agent/service.ts`); the exact console step is documented in the README.
- **Suggestion:** Use a dedicated error (`ModelAccessNotEnabledException`) with a console deep link, align the wording between the availability API and the runtime error, and state the propagation delay in the console after the form is submitted.

## FL-10 · Tailwind resolves `content` globs against the process directory, so a multi-project repo silently gets no utilities

- **Date:** 2026-09-17 · **Tool:** Tailwind CSS 3.4 (PostCSS plugin) · **Severity:** low (general ecosystem)
- **Task:** Build the web app from the repo root (`vite build --config web/vite.config.ts`) with `web/tailwind.config.js`.
- **Steps:** Passing the config path to the PostCSS plugin fixed the "content option is missing" warning, but the globs (`./src/**/*.tsx`) were still resolved against the repo root — Tailwind scanned the _server_ sources and emitted almost no utilities. The page rendered unstyled with no error anywhere.
- **Workaround:** `content: { relative: true, files: [...] }`.
- **Suggestion:** Resolve relative globs against the config file by default (or warn when a glob matches zero files).

## FL-11 · The Alexa+ auth checklist and the MCP SDK's bearer middleware disagree about `WWW-Authenticate`

- **Date:** 2026-09-17 · **Tool:** Alexa+ MCP Toolkit (Authentication / QuickStart checklist) vs `@modelcontextprotocol/express` `requireBearerAuth` · **Severity:** medium
- **Task:** Add the Tier-1 client-credentials authentication the toolkit documents in front of `/mcp`.
- **Steps:** The QuickStart checklist says the server "must return 401 Unauthorized (without WWW-Authenticate header) for unauthenticated requests". The SDK's `requireBearerAuth` middleware answers 401 **with** `WWW-Authenticate: Bearer resource_metadata=…`, which is what RFC 9728 discovery (and the SDK's own client) expects.
- **Expectation vs reality:** Expected the toolkit to accept the standard challenge. Reality: two authoritative sources with opposite instructions and no rationale on either side.
- **Workaround:** Kept the SDK's runtime-neutral `verifyBearerToken` for validation and wrote a 10-line middleware that sends the bare 401 JSON (`src/http/authRoutes.ts`); the discovery documents are still served at both well-known paths.
- **Suggestion:** Either accept the RFC 9728 challenge or explain why the header must be absent; and document whether an add-on without account linking may call an unauthenticated server at all.

## FL-12 · The v2 client registers notification handlers by method name, but every example still shows a zod schema

- **Date:** 2026-09-19 · **Tool:** `@modelcontextprotocol/client` 2.0.0 (`setNotificationHandler`) · **Severity:** low
- **Task:** Receive server-initiated `notifications/message` (our alert push) in a test client.
- **Steps:** Followed the v1-era pattern `client.setNotificationHandler(LoggingMessageNotificationSchema, handler)`. The schema is not exported from the client package (only from an internal chunk), and the runtime answered `'undefined' is not a spec notification method; pass schemas as the second argument to setNotificationHandler()`.
- **Expectation vs reality:** Expected the documented v1 signature to keep working or the migration notes to mention the change. Reality: v2 takes the spec method string first (`'notifications/message'`) with the params typed from `NotificationTypeMap`, and custom notifications take `(method, { params: schema }, handler)`. The runtime error is good; the docs are not there yet.
- **Workaround:** `client.setNotificationHandler('notifications/message', (n) => …)` (`test/mcp/notifications.test.ts`).
- **Suggestion:** Add the new signature to the v2 migration guide and the client README, and export the spec schemas from the client package for those who still want schema-based typing.

## FL-05 · Fresh `npm install` resolves TypeScript 6 / ESLint 10, which `typescript-eslint` 8 does not support

- **Date:** 2026-09-16 · **Tool:** general TypeScript toolchain · **Severity:** low (general ecosystem)
- **Steps:** `npm i -D typescript eslint typescript-eslint` pulled TS 6.0 and ESLint 10; typescript-eslint 8.70 declares support for `<6.0` TS and ESLint 9.
- **Workaround:** Pinned `typescript@^5.9`, `eslint@^9`, `@eslint/js@^9`.
