# Live conformance checker

`scripts/verify-live.mjs` probes a **running** CareCompanion server over plain HTTP and grades what it finds against
the requirements the Alexa+ MCP Toolkit documents for a remote MCP server: Streamable HTTP with a sessionful
lifecycle (MCP 2025-11-25, plus the 2025-03-26 handshake the toolkit's lifecycle page shows as its example), tools
that answer inside the 500 ms round-trip budget, visuals delivered as an MCP App (`_meta.ui.resourceUri` →
`ui://…` resource), and — when Tier-1 authentication is switched on — a `401` JSON reply without a
`WWW-Authenticate` header plus the RFC 9728 protected-resource document.

It replaces the curl walk-through in `scripts/mcp-lifecycle.sh` with something that grades instead of merely
succeeding or aborting, and it needs nothing beyond Node 22+ built-ins (`fetch`, `node:fs`, `node:path`,
`node:perf_hooks`, `node:util`).

> **Not a certification.** Amazon's Local Inspector (`addon-local-inspector`) renders an add-on in device frames and
> writes a certification verdict, but it is distributed through the Developer Console and is not available to
> participants outside the United States. This checker is our own probe modelled on that idea. A green verdict here
> means the server behaves as the public documentation describes; it is not an Amazon verdict and does not replace the
> Alexa+ web simulator or Amazon's certification.

## What it verifies

Every rule is an isolated asynchronous check with its own 10 s timeout; one failure never aborts the run. Rules are
executed in dependency order (the read-only calls happen before the session is deleted) and reported in id order.

| id  | Level  | Rule                                                                                                                                                            |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MUST   | `POST initialize` with `protocolVersion: 2025-11-25` → 200 with `result.protocolVersion`, `serverInfo` and `capabilities.tools`                                 |
| 2   | MUST   | The initialize response carries `Mcp-Session-Id`                                                                                                                |
| 3   | MUST   | `notifications/initialized` on that session → 202                                                                                                               |
| 4   | MUST   | `tools/list` → ≥ 1 tool, each with `name`, `description` and `inputSchema`; missing CareCompanion tools are reported (FAIL only if none)                        |
| 5   | MUST   | An MCP Apps tool exists: `_meta.ui.resourceUri` starts with `ui://`; every distinct view is listed by `resources/list` and reads as `text/html;profile=mcp-app` |
| 6   | MUST   | `tools/call` of a read-only tool (`get_todays_plan`, else the first `readOnlyHint` tool) → non-empty `content[0].text` + `structuredContent`                    |
| 7   | MUST   | Round trip of that call: median of 3 calls < 500 ms (the `ms` column of this rule is the median)                                                                |
| 8   | MUST   | `GET /mcp` with `Accept: text/event-stream` → 200 `text/event-stream` (headers only; the body is aborted)                                                       |
| 9   | MUST   | `DELETE /mcp` with the session → 2xx                                                                                                                            |
| 10  | MUST   | The terminated session id → 404 with JSON-RPC error `-32001`                                                                                                    |
| 11  | MUST   | A request without any session id → 400 with JSON-RPC error `-32000`                                                                                             |
| 12  | MUST   | CORS preflight (`Origin: http://localhost:8080`) → `Access-Control-Expose-Headers` includes `Mcp-Session-Id`                                                    |
| 13  | SHOULD | `initialize` with `2025-03-26` (the Alexa+ docs' example handshake) → 200; the negotiated version is reported                                                   |
| 14  | SHOULD | `tools/call` with invalid arguments (`log_dose` with `medication: 123`) → `isError` or a JSON-RPC error, never a 500                                            |
| 15  | SHOULD | `prompts/list` → ≥ 1 prompt and `prompts/get` of the first works                                                                                                |
| 16  | SHOULD | `resources/templates/list` → ≥ 1 template                                                                                                                       |
| 17  | SHOULD | Every tool carries `annotations.openWorldHint === false`                                                                                                        |
| 18  | SHOULD | `GET /healthz` → 200 `{ "ok": true }`                                                                                                                           |
| 19  | SHOULD | Tier-1 auth behaviour (Alexa+ checklist) — see below; SKIP when the server is open and no `--token` was given                                                   |
| 20  | SHOULD | A second `initialize` opens a session whose id differs from the first (sessions are per client)                                                                 |

Rule 19 applies when `--token` is given or the server answers 401 to an anonymous `initialize`. It checks that the
anonymous `initialize` gets a `401` JSON reply **without** a `WWW-Authenticate` header, that
`/.well-known/oauth-protected-resource/mcp` answers 200 with a `resource` ending in `/mcp`, and — with `--token` — that
the whole MUST lifecycle (rules 1–12) passed over `Authorization: Bearer`.

Rules 13, 19 and 20 open sessions of their own and close them again, so a run leaves no sessions behind.

## Running it

```bash
node scripts/verify-live.mjs <base-url> [--out docs/conformance/verdict.json] [--token <bearer>] [--strict]
npm run verify:live -- <base-url> [...]      # same thing through the package script
```

`<base-url>` is the server origin; the probe talks to `<base-url>/mcp` (a trailing `/mcp` is tolerated). The first
request is an ungraded warm-up `GET /healthz` with a 60 s ceiling so a sleeping free-tier deployment is measured
after it has woken up, not during the cold start.

### Local server

```bash
npm run build:server
PORT=3100 AGENT_BRAIN=rules SEED_ON_BOOT=always node dist/server/main.js &
node scripts/verify-live.mjs http://127.0.0.1:3100
```

`npm run dev` works just as well (`http://127.0.0.1:3000` by default).

### Deployed server

```bash
node scripts/verify-live.mjs https://<your-host> --out docs/conformance/verdict.json
```

When the deployment runs with `MCP_AUTH=client_credentials`, fetch a token first (HTTP Basic client auth,
`grant_type=client_credentials`, exactly as the Alexa+ add-on does) and pass it in:

```bash
TOKEN=$(curl -sS -u "$MCP_CLIENT_ID:$MCP_CLIENT_SECRET" -d grant_type=client_credentials https://<your-host>/oauth/token | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
node scripts/verify-live.mjs https://<your-host> --token "$TOKEN"
```

Without the token the MUST lifecycle is blocked at rule 1 (the server answers 401, which is what it should do); rule
19 still verifies the shape of that 401 and the protected-resource document.

### In CI

`test/scripts/verifyLive.test.ts` boots the real Express app on an ephemeral port, spawns the checker against it
(open, and with client-credentials auth on) and asserts a PASS verdict, all 12 MUST rules green, rule 7 under 500 ms
and rule 19 green with a token. It runs with `npm test` or `npx vitest run test/scripts`.

## Reading the verdict

The table lists each rule with its id, level, status, wall time in ms and a one-line detail; the last line sums it up:

```
VERDICT: PASS (must 12/12, should 7/7) → docs/conformance/verdict.json
```

- **PASS / FAIL / SKIP** — SKIP means the rule could not be evaluated (a prerequisite failed, or it does not apply,
  e.g. rule 19 on an open server) and is counted in neither the pass nor the fail column; the `x/y` counts are passed
  over evaluated rules.
- **Verdict and exit code** — `PASS` (exit 0) when no MUST rule failed. With `--strict` a failing SHOULD rule also
  turns the verdict to `FAIL` (exit 1). Exit 2 means a usage or I/O error (bad URL, unwritable `--out`).
- **`ms`** — the rule's wall time including every request it made; for rule 7 it is the median round trip itself.

The JSON verdict written to `--out` has this shape:

```json
{
  "target": "http://127.0.0.1:3100/mcp",
  "checkedAt": "2026-09-19T08:00:00.000Z",
  "auth": "anonymous",
  "strict": false,
  "protocolVersions": { "2025-11-25": "2025-11-25", "2025-03-26": "2025-03-26" },
  "summary": {
    "must": { "pass": 12, "fail": 0, "skip": 0 },
    "should": { "pass": 7, "fail": 0, "skip": 1 },
    "verdict": "PASS"
  },
  "rules": [{ "id": 1, "level": "MUST", "title": "…", "status": "PASS", "detail": "…", "ms": 12 }]
}
```

`protocolVersions` maps each requested version to the one the server negotiated (`null` when that initialize did not
succeed). `docs/conformance/verdict.json` is the default output so a run against the deployed server can be committed
next to this file as the current readiness report.
