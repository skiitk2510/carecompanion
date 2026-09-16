# Product feedback

Feedback on every tool, API and SDK used to build CareCompanion, in the order we met them. Each section: what
worked, what needs work, onboarding, and whether we would build on it again. Concrete incidents are cross-referenced
to [friction-log.md](friction-log.md).

## MCP TypeScript SDK v2 (`@modelcontextprotocol/server`, `/node`, `/express`, `/client` 2.0.0)

- **What worked:** `McpServer.registerTool` with zod v4 input/output schemas gives typed handlers and free JSON Schema
  for hosts; invalid arguments never reach a handler. The sessionful `NodeStreamableHTTPServerTransport` handled the
  complete 2025-11-25 lifecycle (initialize → GET stream → DELETE → 404 on a stale id) exactly as the spec says, and
  the same server served stdio with one extra file. The client package made real integration tests trivial: our
  agent brain and our test suite both use `@modelcontextprotocol/client` over loopback HTTP.
- **Needs work:** the documented default handler is stateless and answers GET/DELETE with 405 — the sessionful
  pattern a voice host needs lives only in an example (FL-01). Output-schema violations are found at runtime with a
  message that names neither the tool nor the key (FL-06), and handler results have to be typed as the SDK's own
  `CallToolResult` (FL-07). The split-package symbol map is not documented (FL-02).
- **Onboarding:** an afternoon to a verified endpoint, most of it spent locating symbols and the session pattern.
- **Would build on it again:** yes — the runtime is solid; the gaps are documentation and typing.

## MCP Apps (`@modelcontextprotocol/ext-apps` 2.0.0)

- **What worked:** `registerAppTool` + `registerAppResource` turn one existing tool into a rendered view with a
  dozen lines; `useApp` gives a React view the host bridge with typed handlers (`ontoolinput`, `ontoolresult`,
  `onteardown`), and `callServerTool` lets the view act through the same tools the model uses — no second API.
  `useHostStyles` made the dashboard adopt the host theme without a design system.
- **Needs work:** which _plain_ tools a view may call through `callServerTool` (visibility defaults for tools
  without `_meta.ui`) is not stated; we could only verify host by host. The single-file build recipe (Vite +
  `vite-plugin-singlefile`) is folklore rather than a template.
- **Onboarding:** one evening including the build pipeline.
- **Would build on it again:** yes — it is the right abstraction for a voice-first host with a screen.

## MCP Inspector (V2, CLI + UI)

- **What worked:** `--cli --method tools/list` and `tools/call` against both HTTP and stdio made every milestone
  verifiable from a shell; the UI walk-through of each tool caught wording issues in spoken text.
- **Needs work:** the CLI's flag order ("mode flags before app options") is easy to get wrong and the error is generic.
- **Would build on it again:** yes.

## Amazon Bedrock — Converse API with Claude Haiku 4.5 (`@aws-sdk/client-bedrock-runtime`)

- **What worked:** Converse's tool-use loop maps one-to-one onto MCP tools (name + description + JSON Schema),
  so the MCP server's own `tools/list` is the model's tool definition — no duplication. Haiku 4.5 is fast and cheap
  enough for a voice loop (a few thousand input tokens per turn).
- **Needs work:** model access is a two-step account prerequisite ("agreement" in the availability API, "use case
  details form" in the runtime error) surfaced through a `ResourceNotFoundException` with a 15-minute propagation
  delay (FL-08, FL-09). JSON Schema keywords that zod emits (`$schema`) must be stripped by hand. All tool results
  for one round must be returned in a single user message — sensible, but easy to get wrong without an example.
- **Onboarding:** the SDK part took an hour; the account part is still blocked on the form at the time of writing.
- **Would build on it again:** yes, with the rule-based fallback we shipped — a demo must not depend on an
  account-level switch.

## Agent Skills (`SKILL.md`, agentskills.io)

- _To be completed after the skill has driven the hosted server end to end (M6)._

## Web Speech API (Chrome)

- _To be completed after the web app's voice loop is recorded (M4)._

## Render (free web service)

- _To be completed after deployment (M7)._

## Alexa+ developer surface

- _To be completed: the local inspector run and the documentation experience (M6)._
