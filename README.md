# CareCompanion

An eldercare-coordination agent for Alexa+: medication reminders with safety guardrails, daily voice check-ins with symptom escalation, and a family caregiver dashboard delivered as an MCP App.

Built for the [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/) (Alexa+ track · AWS Builder mini · Open Source mini).

> **Status:** early scaffold — walking skeleton in progress. Full README (quickstart, architecture, demo, safety scope) lands with the first milestone.

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

## License

MIT — see [LICENSE](LICENSE).
