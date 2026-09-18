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

## Devpost form — the real fields (read from the draft on 2026-09-18)

The submission is a five-step wizard. Draft id `1187950`, project name `CareCompanion`, tagline as above (198/200
characters). What each step needs:

1. **Project overview** — name + elevator pitch. _Done._
2. **Project details** — "About the project" (Markdown; Devpost suggests Inspiration / What it does / How we built
   it / Challenges / Accomplishments / What we learned / What's next), "Built with" tags (≤ 25), "Try it out" links,
   image gallery (≤ 15, 3:2), **video demo link (required by the browser, so this step cannot be saved before the
   video exists)**.
3. **Additional info** (for judges; not public unless noted) — submitter type, organization ("N/A"), country
   (appears in gallery), Canada province ("N/A"), **primary track(s)** (multi-select; appears in gallery), repo URL,
   new vs existing, **AWS Builder mini** Yes/No + "which AWS services and how", **Open Source mini** Yes/No +
   contribution URL + repo URL + GitHub username + description, optional **Feature Requests**, optional **Friction
   Log** (a single-line field: put the URL), optional **Project Testing Link** (the live URL), **Feedback questions
   1–5** (all required), three eligibility attestations (required checkboxes — the submitter ticks them).
4. **Finalization** — review + submit (the submitter clicks).

### "Built with" tags

typescript, node.js, express, mcp, model-context-protocol, mcp-apps, agent-skills, amazon-bedrock, claude, aws-sdk,
react, vite, tailwindcss, zod, vitest, web-speech-api, render, github-actions, alexa

### "Try it out" links

- https://github.com/skiitk2510/carecompanion
- Live: `https://<render-host>/` — _fill in after deployment_

### Additional-info answers (paste-ready; also entered in the draft)

- Submitter type: Individual · Organization: N/A · Country: India · Canada province: N/A
- Primary track: **Alexa+** · Repo: https://github.com/skiitk2510/carecompanion · New project: **New**
- AWS Builder mini: **Yes** · Open Source mini: **Yes** (contribution URL = repo URL; GitHub username `skiitk2510`)
- Project testing link: the live URL — _fill in after deployment_

**AWS services and how:** Amazon Bedrock (Converse API, Anthropic Claude Haiku 4.5 through the `us.` cross-region
inference profile, `@aws-sdk/client-bedrock-runtime`) is the conversational brain of the simulated Alexa+
experience. On every turn the server sends the utterance and history to Bedrock together with the MCP server's own
`tools/list` converted into Converse toolSpecs; every requested `toolUse` is executed through a real MCP client over
loopback Streamable HTTP (initialize, tools/call, DELETE, all logged), all results of a round go back in one user
turn, and the loop continues until `end_turn` (`src/agent/bedrockBrain.ts`, `src/agent/mcpExecutor.ts`). The region
is pinned (us-east-1); per-IP rate limits, a daily turn cap and a five-minute pause after access errors guard the
loop; a rule-based fallback brain answers when Bedrock is unavailable; credentials are a least-privilege IAM user.
Documented in the README and `docs/product-feedback.md`; unit-tested with a scripted Converse; exercised live with
`npm run agent:smoke`.

**Open Source mini description:** a brand-new MIT repository created inside the window (first commit 2026-09-16)
and built in public with CI. It is a complete, reusable MCP server for eldercare coordination (8 tools, resource
template, prompt), the sessionful Streamable HTTP wiring voice hosts need, a dashboard MCP App with inline and
fullscreen modes, an Agent Skill validated with `skills-ref`, Alexa+ Tier-1 client-credentials auth on the SDK's
bearer helpers, a Bedrock tool-use loop over a real MCP client, and 170 tests under three timezones. Most public
MCP examples are stateless toy servers; this shows the whole Alexa+-ready shape plus a safety-guardrail domain, with
a dated friction log and product feedback others can learn from.

**Feature requests (priority):**

1. Critical — state whether an add-on without account linking may call an unauthenticated server, and reconcile the
   "401 without `WWW-Authenticate`" checklist with RFC 9728 discovery as the MCP SDK implements it.
2. Important — publish the Local Inspector on npm / outside the Developer Console so it can run in CI and by
   developers who cannot open the console.
3. Important — open the MCP Toolkit (alexa-ai, web simulator) outside the United States, at least for dev-stage.
4. Nice-to-have — MCP SDK: type `structuredContent` from `outputSchema`, name the tool/key in validation errors,
   ship a sessionful handler in the package.
5. Nice-to-have — Bedrock: a dedicated model-access error with a console deep link; one name for the prerequisite.

**Friction log field (single line, URL-typed — the server rejects anything but a bare URL):**
`https://github.com/skiitk2510/carecompanion/blob/main/docs/friction-log.md`. The entry format (task, steps,
expected vs actual, severity, workaround, suggestion) is described inside the document itself and in Feedback Q3.

_Status 2026-09-18: step 3 saved on Devpost (draft 1187950, "3/5 steps done"); step 2 waits for the video URL;
step 4 (Official Rules + Terms checkbox and the Submit button) is the submitter's click on Oct 20. Devpost states
that a submitted project can still be edited until the deadline._

**Feedback questions 1–5:** the per-tool answers are the condensed form of [product-feedback.md](product-feedback.md)
(sections: MCP SDK v2, MCP Apps, MCP Inspector, Bedrock, Alexa+ docs, Agent Skills, Web Speech, Render). Q1 = tools
and what for; Q2 = what worked; Q3 = needs work with FL-xx references; Q4 = onboarding time-to-hello-world; Q5 = would
build again, Yes with caveats. The Render and Web Speech lines are marked "[to be completed after deployment]" and
must be finished before submitting.

## Images to upload with the submission

`docs/figures/web-app.png` (the simulated Alexa+ experience), `docs/figures/web-app-guard.png` (the duplicate-dose
guard), `docs/figures/mcp-app-inline.png` and `docs/figures/mcp-app-fullscreen.png` (the dashboard as an MCP App in
a reference host, inline and fullscreen). Regenerate with `npm run figures`.

## Links

- Repository (MIT): https://github.com/skiitk2510/carecompanion
- Live MCP endpoint + demo: `https://<render-host>/` (MCP at `/mcp`) — _fill in_
- Demo video: _fill in_
- Product feedback: `docs/product-feedback.md` · Friction log: `docs/friction-log.md`
