# Devpost submission — CareCompanion

_Draft of the text description. Fill the two placeholders (live URL, video URL) before submitting. Track: **Alexa+**.
Mini-challenges: **AWS Builder** (Amazon Bedrock) and **Open Source** (new MIT repository created during the hackathon)._

## Tagline

An eldercare-coordination MCP server for Alexa+: medication reminders with safety guardrails, daily voice check-ins
with symptom escalation, and a family dashboard that Alexa+ renders as an MCP App.

## The problem

Nine in ten older adults take at least one prescription and most take several. The failure mode is rarely
dramatic: a dose taken twice because the morning blurred together, a warfarin dose forgotten, a new painkiller that
quietly interacts with what is already in the cabinet, a "bit dizzy" that nobody hears about until the fall. The
people who could catch these things — adult children — live elsewhere and only find out afterwards. Voice
assistants are already in these kitchens; what is missing is the safety logic and the family loop.

## What we built

**CareCompanion** is a self-hosted MCP server (Streamable HTTP, spec 2025-11-25) that gives an Alexa+-class agent a
safe, spoken interface to one elder household, plus an Agent Skill that teaches any agent how to use it, plus a
simulated Alexa+ web experience for the demo.

Elder-facing tools (voice-first, every result is written to be spoken):

| Tool              | What it does                                                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_todays_plan` | Today's doses, what is next, anything missed, appointments, and whether the elder has checked in.                                                                                                                      |
| `log_dose`        | Records a dose by whatever the elder calls it ("my blood pressure pill"). A **duplicate/too-soon guard** refuses and asks for explicit confirmation and a reason; overrides are recorded and the caregiver is alerted. |
| `skip_dose`       | Records a deliberate skip; critical medications alert the caregiver.                                                                                                                                                   |
| `daily_checkin`   | Mood and symptoms in the elder's own words; **symptom escalation** notifies caregivers for urgent symptoms and returns emergency guidance the agent must speak first.                                                  |
| `call_for_help`   | Alerts every caregiver at once and returns emergency guidance.                                                                                                                                                         |

Caregiver-facing tools:

| Tool                | What it does                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_medication`    | Always adds; returns **informational interaction and allergy warnings** against the current list, with a disclaimer.                                                                |
| `caregiver_summary` | Weekly adherence, today's doses, open alerts, the check-in trend, appointments — and the **family dashboard as an MCP App** rendered inline by hosts that support it (Alexa+ does). |
| `resolve_alert`     | Acknowledge or resolve with a note: an audit trail the family can trust.                                                                                                            |

Plus a resource (`carecompanion://elder/{elderId}/adherence`) and a prompt (`morning_briefing`).

## How it works

```
Alexa+ / any MCP host ──Streamable HTTP──▶ CareCompanion MCP server (Node 24, TypeScript)
                                            ├─ 8 tools · 1 resource · 1 prompt (zod schemas, spoken text + structured content)
                                            ├─ guardrails: dose guard · interaction table · escalation bands  (pure functions, tested)
                                            ├─ household store (today-relative demo seed, timezone-correct)
                                            └─ ui:// dashboard resource = the MCP App view (single-file React)

Simulated Alexa+ web app ──/api/agent──▶ Bedrock Converse (Claude Haiku 4.5) ──MCP client over loopback HTTP──▶ the same tools
                                             └─ rule-based fallback brain when Bedrock is unavailable
Agent Skill (SKILL.md) ──▶ teaches Claude Code / any agent the safe workflows against the hosted server
```

Every tool runs in memory in a few milliseconds (no LLM inside the server, as a voice host expects). The
conversational brain is Amazon Bedrock; it calls the MCP tools through a real MCP client on every turn — the
same wire protocol Alexa+ would use — and a rule-based brain keeps the demo alive if model access or credits lapse.

## What is real and what is simulated

- Real: the MCP server, its tools/resource/prompt, the guardrails and their tests (160+), the MCP App view, the Agent
  Skill, the Bedrock tool-use loop, the live deployment.
- Simulated: the Alexa+ device experience (a web app with browser speech recognition and synthesis), caregiver
  notifications (recorded on the alert and logged; no SMS/email is sent), and the household data (synthetic, resets
  on restart — no real patients, no PHI).

## Safety and scope

CareCompanion is a coordination and reminder tool, not medical advice. Interaction warnings are informational and
sourced from a small curated table; escalation errs toward alerting a human; nothing is ever overridden without an
explicit confirmation and a reason from the person. The server implements the Alexa+ Tier-1 service-level
authentication (client-credentials token endpoint, RFC 8414/9728 discovery, Bearer-guarded `/mcp`) behind a switch;
the public demo runs it open because the household is synthetic. A production deployment would add user-level
account linking, a real datastore, and clinically maintained interaction data.

## Built with

TypeScript, Node.js, Express 5, MCP TypeScript SDK v2 (`@modelcontextprotocol/server|node|express|client`),
`@modelcontextprotocol/ext-apps` (MCP Apps), zod, Amazon Bedrock (Converse API, Claude Haiku 4.5), React 19, Vite,
Tailwind CSS, Web Speech API, vitest, Render.

## Links

- Repository (MIT): https://github.com/skiitk2510/carecompanion
- Live MCP endpoint + demo: `https://<render-host>/` (MCP at `/mcp`) — _fill in_
- Demo video: _fill in_
- Product feedback: `docs/product-feedback.md` · Friction log: `docs/friction-log.md`
