# The classic Alexa Skill (Alexa Skills Kit)

The hackathon organizers suggested demoing "your MCP being called from an Alexa Skill", since the Alexa+ add-on
toolkit itself is not open to participants. CareCompanion therefore ships a **real, deployable custom skill**:
Amazon's speech recognition and NLU turn what the person says into an intent, the skill endpoint on this server
turns the intent back into a sentence, and the sentence goes through the **same agent loop as the web app** —
Bedrock (Claude Haiku 4.5) or the offline rule brain — which calls the **MCP tools over a real loopback MCP client**.
Nothing in this path shortcuts into the domain layer.

**What is real:** the Alexa Skills Kit skill (interaction model, manifest, signed requests, the developer-console
simulator and any Echo device on the owner's account), the ASK SDK endpoint, the agent loop, the MCP session and
tool calls, the guardrails, the APL screen. **What is simulated:** Alexa+ itself (the classic skill has no
MCP-native host; this server _is_ the bridge), caregiver notifications (recorded on the alert, no SMS/email), and
the household (synthetic, re-seeded on every restart).

```
"Alexa, tell care companion I took my lisinopril"
   │  Amazon: speech → TookIntent {medication: lisinopril}   (signed POST)
   ▼
POST /alexa  ── ask-sdk-express-adapter (signature + timestamp verified on the raw body)
   │  src/alexa/handlers.ts: TookIntent → "I took my lisinopril"
   ▼
AgentService.respond({ utterance, speaker: 'elder', history })   ← history = Alexa session attributes
   │  Bedrock or rule brain → MCP client → http://127.0.0.1:<port>/mcp
   ▼
log_dose → dose guard: "You already took Lisinopril at 8:05 a.m. today. I won't record another dose unless…"
   │
   ▼
response: PlainText speech + card + APL document; session stays open
```

## What is in the repository

| Path                                                | Purpose                                                                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/alexa/skill.ts`                                | Builds the ASK SDK skill and returns the Express handlers mounted on `POST /alexa` (`createAlexaHandlers`).    |
| `src/alexa/handlers.ts`                             | Intent handlers, the intent → utterance mapping, session history, speech shaping, the 7-second agent deadline. |
| `src/alexa/apl.ts`                                  | The APL document shown on Echo Show devices and in the console's Device Display.                               |
| `src/alexa/config.ts`                               | `ALEXA_*` environment variables.                                                                               |
| `skill-package/skill.json`                          | Skill manifest (custom skill, en-US, APL interface, HTTPS endpoint, privacy flags).                            |
| `skill-package/interactionModels/custom/en-US.json` | Invocation name, intents, sample utterances, the `MEDICATION_NAME` slot type.                                  |
| `test/alexa/skill.test.ts`                          | End-to-end tests: hand-built Alexa request envelopes against the real server with verification switched off.   |

### Intents → the sentence the agent hears

| Intent (slot)                           | Example the person says                                   | Utterance sent to the agent (speaker)                                    |
| --------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `LaunchRequest`                         | "open care companion"                                     | _none_ — "Hi Eleanor. You can ask for your plan, tell me what you took…" |
| `PlanIntent`                            | "what's my plan today", "morning briefing", "what's next" | `what's my plan today` (elder)                                           |
| `TookIntent` (`medication`)             | "I took my lisinopril", "log my blood pressure pill"      | `I took my {medication}` (elder)                                         |
| `OverrideIntent` (`reason`)             | "yes record it anyway because the doctor said so"         | `yes, record it anyway because {reason}` (elder)                         |
| `SkipIntent` (`medication`)             | "skip my metformin"                                       | `skip my {medication}` (elder)                                           |
| `FeelingIntent` (`feeling`)             | "I'm feeling a bit dizzy", "I feel fine"                  | `I'm feeling {feeling}` (elder)                                          |
| `CallForHelpIntent`                     | "I need help", "help I fell", "I can't breathe"           | `Help. I need help right now.` (elder)                                   |
| `CaregiverSummaryIntent`                | "how is mom doing this week", "caregiver summary"         | `how is Eleanor doing this week` (**caregiver**)                         |
| `AnythingIntent` (`query`)              | "tell it what time is my appointment"                     | the raw `{query}` (elder)                                                |
| `AMAZON.HelpIntent`                     | "help"                                                    | _none_ — lists what to say; "if something is wrong, say: I need help"    |
| `AMAZON.FallbackIntent`                 | anything the model cannot place                           | _none_ — "I didn't catch that…"                                          |
| `AMAZON.StopIntent` / `Cancel` / `Home` | "stop"                                                    | _none_ — "Take care, Eleanor." and the session ends                      |

The fixed phrasings are the ones the offline rule brain routes exactly like the web demo; the Bedrock brain reads
them as plain English. A missing slot ("I took my…") is answered with a short question locally, without an agent
turn; an override without a reason is asked for the reason (the guard requires a confirmation **and** a reason).
When a `MEDICATION_NAME` synonym matches ("coumadin", "diabetes pill"), the canonical slot value is used; otherwise
the words as heard are passed through and the server's own medication resolver deals with them.

The last six turns travel in the Alexa **session attributes** (`sessionAttributes.history`), which is how
"yes, record it anyway because…" still knows which medication was refused a moment earlier. Emergency guidance
from `call_for_help` or `daily_checkin` is spoken **first and verbatim**, the session stays open, and Alexa is given
no reprompt so it does not follow an emergency with "Anything else?".

Every reply is `PlainText` output speech (markdown stripped, under Alexa's 8000-character cap) plus a `SimpleCard`
titled _CareCompanion_; devices that report `Alexa.Presentation.APL` also receive a `RenderDocument` directive with
the reply in large type and the footer "Not medical advice · demo data". Errors become a calm spoken apology —
never a stack trace. Alexa allows roughly 8 seconds per request; if the agent has not answered within
`ALEXA_AGENT_TIMEOUT_MS` (7 s) the skill says "Give me a moment and ask again" and drops the late reply.

## Environment variables

| Variable                 | Default | Meaning                                                                                                      |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------ |
| `ALEXA_SKILL`            | `on`    | `off` leaves `POST /alexa` unmounted (`/healthz` reports `alexaSkill: false`).                               |
| `ALEXA_SKILL_ID`         | _unset_ | `amzn1.ask.skill.…` from the console. When set, requests carrying any other skill id are rejected.           |
| `ALEXA_VERIFY_SIGNATURE` | `true`  | Verify Amazon's request signature (`SignatureCertChainUrl` + `Signature-256`). `false` only for local tests. |
| `ALEXA_VERIFY_TIMESTAMP` | `true`  | Reject requests older than 150 seconds (replay protection). `false` only for local tests.                    |
| `ALEXA_AGENT_TIMEOUT_MS` | `7000`  | How long one turn may wait for the agent before answering "give me a moment".                                |

Only an explicit `false`/`0`/`no`/`off` switches a verification off; both checks are required by Amazon for a
skill hosted as a web service, and the server logs a warning at boot whenever either is off.

## Ten-minute setup (the skill owner)

You need the server deployed over HTTPS (Render works; the free tier's cold start is the only wrinkle) and a
**free Amazon developer account** — <https://developer.amazon.com/> → _Sign in_ → create an account (no fee, no
AWS account needed for a self-hosted endpoint).

1. Open the **Alexa Developer Console**: <https://developer.amazon.com/alexa/console/ask> → **Create Skill**.
2. Name it `CareCompanion`, primary locale **English (US)**. Choose **Custom** for the experience/model, and
   **Provision your own** for the hosting method (the endpoint is this server, not Alexa-hosted). Template:
   **Start from Scratch**. Create.
3. Left menu → **Interaction Model → JSON Editor**. Replace the whole document with the contents of
   `skill-package/interactionModels/custom/en-US.json` (it contains the invocation name `care companion`, all
   intents, sample utterances and the `MEDICATION_NAME` slot type). **Save Model**.
4. Left menu → **Interfaces**: switch on **Alexa Presentation Language** (APL) so Echo Show devices and the
   simulator's Device Display render the reply card. Save.
5. Left menu → **Endpoint** → **HTTPS**. Default region URI: `https://<your-host>/alexa`
   (for Render: `https://<service>.onrender.com/alexa`). SSL certificate type: _"My development endpoint is a
   sub-domain of a domain that has a wildcard certificate from a certificate authority"_ — that is what
   `*.onrender.com` is. (A custom domain with its own certificate would use _"…has a certificate from a trusted
   certificate authority"_.) **Save Endpoints**.
6. Left menu → **Interaction Model → Invocation** (or the JSON Editor) → **Build Model**. Wait for
   "Build Successful" (about a minute).
7. Copy the **Skill ID** (Endpoint page, or the skill list: _View Skill ID_ — `amzn1.ask.skill.…`) into the
   server's environment as `ALEXA_SKILL_ID` and redeploy. From then on the endpoint only serves this skill.
8. **Test** tab → set the drop-down from _Off_ to **Development**. Type or hold the mic and say:

   | Say                                                            | Expect                                                                                                                |
   | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
   | `open care companion`                                          | "Hi Eleanor. You can ask for your plan, tell me what you took, or say how you're feeling."                            |
   | `what's my plan today`                                         | "Good morning, Eleanor. You have 6 doses today…" (the greeting follows the household's clock)                         |
   | `I took my lisinopril`                                         | **The guard beat:** "You already took Lisinopril at 8:05 a.m. today. I won't record another dose unless you're sure…" |
   | `yes record it anyway because the doctor told me to double it` | "Okay — I've recorded the extra Lisinopril and flagged it for your caregiver with your reason."                       |
   | `I'm feeling a bit dizzy`                                      | "That sounds worth a call. I've let Priya Whitfield-Singh know right away. If it gets worse, call 911."               |
   | `help I fell`                                                  | "This could be an emergency. Please call 911 right now. I'm alerting Priya Whitfield-Singh and Daniel Whitfield."     |
   | `how is mom doing this week`                                   | the caregiver summary, opening with the 7-day adherence percentage                                                    |
   | `stop`                                                         | "Take care, Eleanor." — session ends                                                                                  |

   The guard beat depends on the household being in the "mid-morning" state (the 8 a.m. doses already taken). The
   server seeds that at boot; if the demo has been running for a while, reset it from the web app's Demo menu
   (`POST /api/demo/reset { scenario: "mid-morning" }`) first.

If the console reports "There was a problem with the requested skill's response", check the server log first
(below) — a non-200 from `/alexa` (usually a signature or skill-id rejection, or a cold-start timeout) is what
Alexa reports that way.

### Alternative: `ask-cli`

The repository keeps the standard `skill-package/` layout, so the CLI can deploy it without the console:

```bash
npm install -g ask-cli
ask configure                      # Login with Amazon (browser); no AWS profile is needed for a self-hosted endpoint
sed -i '' 's#REPLACE-WITH-YOUR-RENDER-HOST.onrender.com#<your-host>#' skill-package/skill.json
ask init                           # "existing skill package" → ./skill-package; writes ask-resources.json + .ask/
ask deploy                         # creates the skill, uploads the manifest and builds the en-US model
ask dialog --locale en-US          # interactive text simulator: "open care companion", "what's my plan today", …
```

`ask init` writes `ask-resources.json` and `.ask/ask-states.json` (the skill id lives there after the first
deploy; `ask smapi get-skill-manifest -s <skill-id>` shows what Amazon stored). Set `ALEXA_SKILL_ID` from that id.
Skill icons are only required when submitting for certification, which this demo skill does not do.

## How a request reaches the MCP server

1. Amazon POSTs a signed JSON envelope to `/alexa`. `src/http/app.ts` skips the JSON body parser for that path so
   the adapter receives the raw bytes; `ask-sdk-express-adapter` checks the certificate chain URL, downloads and
   validates Amazon's signing certificate (cached), verifies the `Signature-256` over the body, and checks the
   request timestamp. Failures are answered `400` before any handler runs.
2. `ask-sdk-core` dispatches to the handler for the request type / intent (`src/alexa/handlers.ts`), which
   rebuilds the utterance and calls `AgentService.respond()` with the session history.
3. The agent opens a **real MCP session over loopback HTTP** (`initialize` → `tools/list` → `tools/call` →
   `DELETE`), exactly as an external host would; the brain (Bedrock or rules) decides which tools to call.
4. The tool result's spoken text comes back as the reply; the handler stores the turn in the session attributes,
   shapes the speech, adds the card and the APL document and answers within Alexa's deadline.

Log lines to look for (one request):

```
INFO  [carecompanion:alexa] Alexa Skill ready {"endpoint":"https://<host>/alexa","skillId":"amzn1.ask.skill.…","verifySignature":true,"verifyTimestamp":true,"agentTimeoutMs":7000}
INFO  [carecompanion:mcp] session opened {"id":"…","open":1}
INFO  [carecompanion:agent] mcp tools/call {"tool":"log_dose","isError":false,"ms":18}
INFO  [carecompanion:mcp] session closed {"id":"…","open":0}
INFO  [carecompanion:alexa] alexa request {"type":"IntentRequest","intent":"TookIntent","ms":212,"tools":["log_dose"],"brain":"rules","endSession":false}
```

`brain` tells you whether Bedrock or the rule brain answered; `tools` are the MCP tools the turn called; `emergency:
true` marks a turn that spoke emergency guidance; `timedOut: true` marks a "give me a moment" answer.

## What the simulator shows

- **Skill I/O** (Test tab, right-hand panel): the exact **JSON Input** Amazon sent (request type, intent, resolved
  slots with entity-resolution results, `session.attributes` carrying the history) and the **JSON Output** this
  server returned (`outputSpeech` PlainText, `card`, the `Alexa.Presentation.APL.RenderDocument` directive,
  `sessionAttributes.history`, `shouldEndSession`).
- **Device Display**: with APL enabled in step 4, the dark CareCompanion card with the reply in large type and the
  "Not medical advice · demo data" footer, in the Echo Show frame you pick (Small/Medium/Large Hub).
- **Device Log** lists the directives; the simulator does not run the request-signature check that a real device
  would — the server does, on every request.

## Testing locally without Amazon

Both verifications can be switched off for a local run so hand-built envelopes are accepted (never do this on the
public host):

```bash
ALEXA_VERIFY_SIGNATURE=false ALEXA_VERIFY_TIMESTAMP=false PORT=3100 AGENT_BRAIN=rules SEED_ON_BOOT=always node dist/server/main.js
curl -s http://127.0.0.1:3100/alexa -H 'content-type: application/json' -d '{
  "version":"1.0",
  "session":{"new":true,"sessionId":"s1","application":{"applicationId":"amzn1.ask.skill.local"},"user":{"userId":"u1"},"attributes":{}},
  "context":{"System":{"application":{"applicationId":"amzn1.ask.skill.local"},"user":{"userId":"u1"},"device":{"deviceId":"d1","supportedInterfaces":{}}}},
  "request":{"type":"IntentRequest","requestId":"r1","timestamp":"2026-09-19T10:00:00Z","locale":"en-US",
             "intent":{"name":"TookIntent","confirmationStatus":"NONE","slots":{"medication":{"name":"medication","value":"lisinopril"}}}}}' | jq .response.outputSpeech.text
```

`npx vitest run test/alexa` runs the same conversation end to end (launch, plan, the guard and its override through
session attributes, the dizziness escalation, help, the caregiver summary, APL on/off, the agent deadline) and
proves that with verification **on** a forged signature is rejected with `400` by the adapter rather than `500`
"Do not register any parsers" — i.e. the raw body really reaches the adapter.

## Limits worth knowing

- This is a classic skill, not Alexa+: there is no MCP-native host in the loop, and Amazon's NLU only knows the
  intents and sample utterances in the model. Phrasings far from the samples land in `AMAZON.FallbackIntent`; the
  `AnythingIntent` carrier phrases ("tell it …", "say …") are the escape hatch to free text.
- The bare word "help" belongs to Alexa's built-in `AMAZON.HelpIntent`, so the model does not claim it. The
  skill's help text ends with "if something is wrong right now, say: I need help", which is a `CallForHelpIntent`
  sample.
- The welcome names the seeded elder (Eleanor). The agent itself reads the household from the store, so replies
  follow the data; only the two fixed greetings are static.
- No account linking: everyone who enables the skill talks to the same demo household, which is the point of a
  synthetic demo and would be the first thing to change for real use.
- Certification was not attempted; the skill is meant to run in the **Development** stage on the owner's account.
