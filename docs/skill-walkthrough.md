# Agent Skill walk-through

How to prove the Agent Skill (`skills/carecompanion/SKILL.md`) drives the MCP server from a real agent, and what a
successful run looks like. The skill is validated with `npm run skill:validate` (`skills-ref validate`).

## In Claude Code (interactive)

The repository ships the skill as a project-level skill (`.claude/skills/carecompanion` → `skills/carecompanion`)
and an `.mcp.json` pointing at the local server, so opening the repository in Claude Code is enough:

1. `npm run build && npm start` (or point `.mcp.json` at the hosted URL).
2. Open the repository in Claude Code; approve the `carecompanion` MCP server when asked.
3. Ask, in order:
   - "Give me Eleanor's morning briefing." → expect `get_todays_plan`, a three-sentence briefing and one check-in question.
   - "She took her lisinopril." → in the mid-morning scenario the guard refuses; the agent must relay the refusal and **not** override.
   - "Yes, record it anyway — Dr. Chen told her to double it today." → `log_dose` with `confirmOverride` + reason; caregiver alert raised.
   - "She says she's a bit dizzy." → `daily_checkin`; urgent → Priya notified.
   - "How is she doing this week?" → `caregiver_summary` spoken summary (and the dashboard in hosts that render MCP Apps).
   - "Add ibuprofen 200 mg at 8 and 8 for her knee." → `add_medication`; the agent reads both warnings and the disclaimer.

## Scripted (non-interactive)

```bash
cat > /tmp/carecompanion-mcp.json <<'EOF'
{ "mcpServers": { "carecompanion": { "type": "http", "url": "http://127.0.0.1:3000/mcp" } } }
EOF
claude -p "Use the carecompanion skill. (1) Give me Eleanor's morning briefing. (2) Record that she took her lisinopril — if the guard asks for confirmation, do not override; tell me what it said. (3) Give me the caregiver summary for the week. List the MCP tools you called, in order." \
  --mcp-config /tmp/carecompanion-mcp.json --allowedTools "mcp__carecompanion__*" --output-format json --max-turns 15
```

The JSON result's `result` field is the transcript; the server log shows the matching `session opened` →
`tools/call` → `session closed` lines. (Requires a logged-in `claude` CLI; a stale login returns
`401 OAuth access token is invalid` before any tool is called.)

## What the skill is responsible for

- Choosing the elder vs caregiver tool set and staying in role.
- Never setting `confirmOverride` without an explicit confirmation **and** a reason.
- Speaking `emergencyGuidance` first and verbatim.
- Reading every interaction warning and the disclaimer; never giving medical advice.
- Re-initializing after a `404 / -32001` (server restarted) and tolerating the free-tier cold start.
