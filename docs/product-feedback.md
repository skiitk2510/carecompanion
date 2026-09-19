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
- **Needs work:** which _plain_ tools a view may call through `callServerTool` is not documented — we had to read
  `AppBridge.connect()` to learn that hosts forward any `tools/call` unfiltered and that `visibility` only affects
  tool-list display. The single-file build recipe (Vite + `vite-plugin-singlefile`) is folklore rather than a
  template. A hidden/zero-width host tab makes `size-changed` report absurd heights (19,000 px) — hosts should
  clamp, or the SDK could skip resize notifications while the view has no layout width.
- **Also worked:** one view bundle serving three tools. Registering `get_todays_plan` and `log_dose` with the same
  `resourceUri` as `caregiver_summary` and choosing the screen by the shape of `structuredContent` cost one afternoon
  and no second build; `requestDisplayMode('fullscreen')` gave the inline-to-full transition for free. Server-side,
  `sendLoggingMessage` with the `logging` capability pushed alert notifications to every open session on the first
  try.
- **Onboarding:** one evening including the build pipeline; verified in `basic-host` (initialize → tool-input →
  tool-result → size-changed) the same night.
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

## Agent Skills (`SKILL.md`, agentskills.io) and `skills-ref`

- **What worked:** the format is small enough to write by hand in an hour, `skills-ref validate` caught nothing
  because the rules are clear (name = directory, description length, no stray `version` key), and a project-level
  `.claude/skills/` link makes the skill available the moment the repository is opened in Claude Code.
- **Needs work:** there is no way to declare the MCP server a skill depends on in the frontmatter; the body has
  to explain connection details in prose. A `mcpServers` hint (or a pointer to an `.mcp.json`) would let hosts
  offer to connect automatically.
- **Onboarding:** an hour, most of it deciding what belongs in `references/`.
- **Would build on it again:** yes; see `docs/skill-walkthrough.md` for the reproducible run.

## Web Speech API (Chrome)

- _To be completed after the web app's voice loop is recorded (M4)._

## Render (free web service)

- _To be completed after deployment (M7)._

## Alexa+ MCP Toolkit — documentation experience

_Written from the public documentation (QuickStart + Overview); we could not exercise the `alexa-ai` CLI itself
because the toolkit is documented as available in the United States only._

- **What worked:** the requirements that matter to a server author are stated plainly and match the open standard:
  Streamable HTTP, MCP 2025-11-25, a remote URL (cloudflared is suggested for local development), a
  **500 ms round-trip latency budget**, and MCP Apps for visuals with "dashboards" named as a use case — every one of
  those shaped this project (in-memory tools answer in ~10 ms; the dashboard is an MCP App). The CLI flow
  (`configure` → `new mcp --mcp-server-url` → `deploy` → web simulator → `submit`) is short and readable, and an
  Add-on Agent Skill for coding agents is a great idea. The **MCP Design Guide** is the best part of the surface:
  the display-mode model (inline for summaries, fullscreen for information-dense views, voice-only as a first-class
  case), the Block-vs-Card rendering rule, and the visual foundations (768×480 base canvas, one root scale, type and
  spacing tokens) and accessibility page (48 px targets, 4.5:1 contrast, input parity) are concrete enough to
  implement from directly — our dashboard's inline/fullscreen split and token scale came straight from them.
- **Needs work:** (1) the QuickStart's authentication checklist reads as mandatory (401 without `WWW-Authenticate`,
  PRM document) but never says whether an add-on **without** account linking may talk to an unauthenticated server —
  the single most common question for a hackathon or internal-tool server; (2) the US-only availability is stated in
  the Overview, not on the QuickStart or the hackathon pages, so international entrants discover it late; (3) the
  Add-on Agent Skill has no install command or repository link on the page that introduces it; (4) there is no
  guidance on tool naming/descriptions for the Alexa+ model, nor on how tool `structuredContent` vs spoken text is
  used — the Design Guide's one sentence on the subject ("You can't script what Alexa says, but you can design your
  data so Alexa's responses are rich, accurate, and useful") deserves a whole section with examples; (5) the
  **Local Inspector** (`@alexa-ai/addon-local-inspector`: device frames at ≤10" and ≥11", a certification verdict
  JSON) is exactly what a server author needs, but it is not on npm — it is distributed through the Developer
  Console's Getting Started guide, so anyone who cannot open the console (international entrants, CI) cannot run
  the readiness report, and its prerequisites (Node 24+, a Playwright CLI) are not mentioned on the QuickStart;
  (6) the Client and App Lifecycle page's example handshake uses `protocolVersion: "2025-03-26"` while the Overview
  says 2025-11-25 — server authors need to know which the client actually sends (we verified our server negotiates
  both); (7) the Authentication page documents Tier-1 client-credentials mechanics well but never says whether an
  add-on without account linking may use an unauthenticated server; (8) the checklist's "401 without a
  `WWW-Authenticate` header" contradicts RFC 9728 discovery (which the MCP SDK's `requireBearerAuth` implements by
  sending `WWW-Authenticate: Bearer resource_metadata=…`) — we had to bypass the SDK middleware and answer 401 by
  hand; stating which behaviour Alexa+ actually needs, and why, would save every implementer that detour.
- **Would build on it again:** yes — the toolkit's constraints are the right ones for voice; we would gladly onboard
  the finished server through `alexa-ai` the day the toolkit opens outside the US.
