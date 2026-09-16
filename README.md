# CareCompanion

An eldercare-coordination agent for Alexa+: medication reminders with safety guardrails, daily voice check-ins with symptom escalation, and a family caregiver dashboard delivered as an MCP App.

Built for the [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/) (Alexa+ track · AWS Builder mini · Open Source mini).

> **Status:** the MCP surface is complete — 8 tools · 1 resource · 1 prompt, with the three safety guardrails (duplicate-dose guard with human confirmation, informational interaction/allergy warnings, fail-safe symptom escalation) and a seeded demo household, covered by 145 tests. Next: the Bedrock-powered simulated Alexa+ experience, the web app and the dashboard MCP App view.

## What ships

- **Self-hosted MCP server** (Streamable HTTP, spec 2025-11-25) — `POST|GET|DELETE /mcp`, plus a stdio binary.
- **Agent Skill** (`skills/carecompanion/SKILL.md`) that teaches any agent how to drive the server safely.
- **Simulated Alexa+ web experience** (`web/`) used for the demo, with a Bedrock-powered brain that calls the MCP tools at runtime.
- **Family dashboard MCP App** (`ui/`) rendered inline by MCP App hosts (Alexa+, MCP Inspector, basic-host).

## Safety & scope

CareCompanion is a coordination and reminder tool, not medical advice. Demo data is synthetic (no PHI) and resets on restart.

## Running the skeleton

```bash
npm install
npm run build && npm start          # http://127.0.0.1:3000/mcp  (+ /healthz)
npm run mcp:lifecycle               # curl walk-through of the 2025-11-25 session lifecycle
npm run mcp:inspect                 # MCP Inspector against the running server
npm test                            # SDK-client tests against the real Express wiring
```

Boot prints `Warning: Server is binding to 0.0.0.0 without DNS rebinding protection`. That is expected: host-header
validation is applied to `/mcp` only (so platform health checks on `/healthz` keep working) — see
[docs/friction-log.md](docs/friction-log.md) FL-03.

### AWS / Bedrock setup (for the simulated Alexa+ brain)

The conversational brain behind `POST /api/agent` uses Amazon Bedrock (Claude Haiku 4.5 via the `us.` cross-region
profile) and calls the MCP tools over loopback HTTP. Without Bedrock the endpoint still works through a small
rule-based brain, so the MCP server and the demo never depend on AWS being up.

1. In the Bedrock console for **us-east-1**, open _Model access_ → Anthropic and submit the one-time **use case
   details form**, then enable **Claude Haiku 4.5**. Until that is done Bedrock answers
   `ResourceNotFoundException: Model use case details have not been submitted…` and the app falls back to rules.
2. Check access without spending anything:
   ```bash
   aws bedrock get-foundation-model-availability --model-id anthropic.claude-haiku-4-5-20251001-v1:0 --region us-east-1
   ```
   `agreementAvailability.status` must be `AVAILABLE` (it reads `NOT_AVAILABLE` while the form is pending).
3. Give the runtime credentials with `bedrock:InvokeModel` (a local profile, or `AWS_ACCESS_KEY_ID` /
   `AWS_SECRET_ACCESS_KEY` on the host) and keep `BEDROCK_REGION=us-east-1` — the region is pinned explicitly
   because a profile's default region may differ.
4. Try it: `npm run agent:smoke` against a running server prints which brain answered each turn.

## License

MIT — see [LICENSE](LICENSE).
