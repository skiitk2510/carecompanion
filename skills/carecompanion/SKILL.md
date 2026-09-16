---
name: carecompanion
description: "Eldercare coordination through the CareCompanion MCP server — medication reminders with duplicate-dose and interaction guardrails, daily check-ins with symptom escalation, and a family caregiver dashboard. Use when someone mentions \"eldercare\", \"medication reminder\", \"did I take my pill\", \"daily check-in\", \"caregiver dashboard\", or asks to brief, log, or review an elder's day. Coordination and reminders only — not medical advice."
license: MIT
compatibility: Needs an MCP-capable agent host connected to a CareCompanion server (Streamable HTTP or stdio); works in any host that can call MCP tools.
metadata:
  author: Saurabh Kumar
  version: "1.0"
  homepage: https://github.com/skiitk2510/carecompanion
---

# CareCompanion

CareCompanion coordinates one elder household: the medication schedule, whether doses were taken, daily
check-ins, and alerts to family caregivers. It is a **coordination and reminder tool, not medical advice**. Every
tool returns text written to be spoken aloud — read it as-is rather than paraphrasing numbers, times or warnings.

## Connect

Hosted server (Streamable HTTP, MCP spec 2025-11-25): `https://<your-carecompanion-host>/mcp`
(replace with the deployed URL; the demo deployment is listed in the repository README).

Local server: `node dist/server/bin/stdio.js` from a checkout after `npm install && npm run build`.

Claude Code / any `.mcp.json` host:

```json
{
  "mcpServers": {
    "carecompanion": { "type": "http", "url": "https://<your-carecompanion-host>/mcp" }
  }
}
```

The server exposes 8 tools, one resource template (`carecompanion://elder/{elderId}/adherence`) and one prompt
(`morning_briefing`). The cheat-sheet with every argument is in [references/tools.md](references/tools.md).

## Who is speaking

Decide first whether you are talking to the **elder** or a **caregiver**, and stay within that role:

- Elder: `get_todays_plan`, `log_dose`, `skip_dose`, `daily_checkin`, `call_for_help`.
- Caregiver: everything above plus `add_medication`, `caregiver_summary`, `resolve_alert`.

Elders cannot add medications or resolve alerts; suggest a caregiver does it from the dashboard.

## Workflows

### 1. Morning briefing (elder)

1. Call `get_todays_plan` (no arguments for the household elder).
2. Speak at most three short sentences: what is next, anything missed, today's or tomorrow's appointment.
3. If `checkedInToday` is false, ask one gentle question ("How are you feeling this morning?") and route the answer
   to workflow 3.

### 2. Guarded dose logging (elder) — never override on your own

1. Call `log_dose` with the medication exactly as the elder said it ("my blood pressure pill", "Coumadin").
2. If the result is `ambiguous`, ask which of the `candidates` they mean, then call again.
3. If `requiresConfirmation` is true, the guard refused a duplicate or too-soon dose. Say the tool's text (it explains
   what was already taken and asks for "yes, record it anyway" plus a reason). **Do not retry silently.**
4. Only when the elder has clearly confirmed **and** given a reason, call `log_dose` again with
   `confirmOverride: true` and `overrideReason: "<their words>"`. The extra dose is recorded and the caregiver is
   alerted automatically.
5. `skip_dose` records a deliberate skip of the next due dose (optional `reason`).

### 3. Symptoms and emergencies (elder)

1. When the elder says how they feel, call `daily_checkin` with `mood` and any `symptoms` in their own words.
2. If the result contains `emergencyGuidance`, say it **first and verbatim**, before anything else, and do not end
   with a question. Urgent and emergency symptoms alert caregivers automatically (`notified` lists who).
3. If the elder asks for help, or describes a fall, chest pain or trouble breathing outside a check-in, call
   `call_for_help` immediately and speak its `emergencyGuidance` verbatim.

### 4. Caregiver review

1. Call `caregiver_summary` (`days` 7 or 30). Hosts that support MCP Apps render the family dashboard inline; in any
   host, read the spoken summary (adherence, open alerts, next appointment).
2. For details, read the resource `carecompanion://elder/{elderId}/adherence` (JSON).
3. Acknowledge or resolve alerts with `resolve_alert` (`action`, optional `resolution` note for the audit trail).

### 5. Adding a medication (caregiver)

1. Collect `name`, `dose`, `scheduleTimes` (HH:mm, household local time) and optionally `purpose`, `instructions`,
   `critical`.
2. Call `add_medication`. It always adds the medication and returns informational `warnings` (interactions with the
   elder's current medications, or listed allergies).
3. Read **every** warning and the disclaimer to the caregiver. Suggest confirming with a pharmacist. Never give
   dosing advice.

## Rules

- Use the tools for every fact; never invent a dose, a time, a result or a warning.
- Keep replies to one to three short sentences of plain spoken language; no lists, markdown or emoji when speaking.
- Times in tool text are already in the household's timezone ("8 a.m.", "6:30 p.m.").
- Never set `confirmOverride` without an explicit confirmation and a reason from the elder.
- You are not a clinician: no medical advice, no dosing instructions, no diagnoses. In a real emergency the
  person should call the household's emergency number (the tools say which).

## Troubleshooting

- `404` with JSON-RPC error `-32001 Session not found`: the server restarted; re-initialize the MCP session.
- The first request after idle can take up to a minute on the free hosting tier (cold start); retry once.
- `ambiguous` results always carry `candidates`; `not_found` results list the active medications to choose from.
- Demo data resets on server restart; nothing here is real patient data.
