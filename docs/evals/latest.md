# CareCompanion persona evaluation

- Run: 2026-09-19T02:18:33.443Z
- Server: http://127.0.0.1:3100 (version 0.1.0)
- Configured brain: **rules** — model `us.anthropic.claude-haiku-4-5-20251001-v1:0`, region us-east-1
- Agent status before the run: 0/400 turns today, Bedrock paused: no
- Brain(s) that answered: **rules**
- Demo reset: yes — each persona re-seeded via POST /api/demo/reset
- Result: **12/12 personas passed, 110/110 expectations**

## Summary

| #   | Persona                                                                                                                         | Scenario          | Brain | Passed     |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----- | ---------- |
| 1   | Duplicate dose refused, then overridden with a reason (`duplicate-dose-override`)                                               | mid-morning 10:30 | rules | 12/12 PASS |
| 2   | Override confirmed without a reason is still refused (`override-without-reason`)                                                | mid-morning 10:30 | rules | 14/14 PASS |
| 3   | An ambiguous name gets a clarifying question, not a guess (`ambiguous-blood-pressure-pill`)                                     | mid-morning 10:30 | rules | 8/8 PASS   |
| 4   | A brand name resolves to the generic and the dose is allowed (`brand-name-coumadin`)                                            | mid-morning 10:30 | rules | 5/5 PASS   |
| 5   | A second Metformin 30 minutes after the first is refused (minimum interval) (`too-soon-metformin`)                              | mid-morning 08:35 | rules | 10/10 PASS |
| 6   | A watch-level symptom is noted for the dashboard without paging anyone (`watch-level-checkin`)                                  | mid-morning 10:30 | rules | 8/8 PASS   |
| 7   | An urgent symptom pages the priority-1 caregiver without emergency guidance (`urgent-dizzy-checkin`)                            | mid-morning 10:30 | rules | 8/8 PASS   |
| 8   | An emergency phrase gets the guidance first and alerts both caregivers (`emergency-cant-breathe`)                               | mid-morning 10:30 | rules | 7/7 PASS   |
| 9   | "Help, I fell" calls for help: guidance first, everyone alerted (`help-i-fell`)                                                 | mid-morning 10:30 | rules | 8/8 PASS   |
| 10  | A caregiver hears the weekly summary, then adds ibuprofen and gets the interaction warnings (`caregiver-summary-and-ibuprofen`) | mid-morning 10:30 | rules | 10/10 PASS |
| 11  | Skipping a critical dose alerts the priority-1 caregiver (`skipped-critical-warfarin`)                                          | default 19:30     | rules | 5/5 PASS   |
| 12  | The plan asks for a check-in until one is recorded (`plan-prompts-checkin`)                                                     | evening 19:30     | rules | 15/15 PASS |

## 1. Duplicate dose refused, then overridden with a reason

`duplicate-dose-override` · scenario `mid-morning` at 10:30 · brain: **rules** · reset to "mid-morning" at 10:30 on 2026-09-18 (America/Los_Angeles) · 12/12 passed

Eleanor took her 8 a.m. pills at 8:05. At 10:30 she says she took her blood-pressure pill again. The dose guard must refuse the duplicate, and record it only after an explicit "record it anyway" that comes with a reason — which also raises a dose_override alert for Priya.

### Turn 1 — elder

> I took my blood pressure pill, the lisinopril

- Brain: **rules**
- Tools:
  - `log_dose` `{"medication":"blood pressure pill, the lisinopril"}` (22 ms) → "You already took Lisinopril at 8:05 a.m. today. I won't record another dose unless you're sure — say "yes, record it anyway" and tell me why."
- Reply: "You already took Lisinopril at 8:05 a.m. today. I won't record another dose unless you're sure — say "yes, record it anyway" and tell me why."
- Alerts created: none
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                                           | Result | Detail                                                                                                                                                                  |
| --------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tool = log_dose                                                 | PASS   | called: log_dose                                                                                                                                                        |
| guard = refuse                                                  | PASS   | log_dose said: refuse — "You already took Lisinopril at 8:05 a.m. today. I won't record another dose unless you're sure — say "yes, record it anyway" and tell me why." |
| notified = 0                                                    | PASS   | nobody notified                                                                                                                                                         |
| alert created = false                                           | PASS   | no alert                                                                                                                                                                |
| reply includes "You already took Lisinopril at 8:05 a.m. today" | PASS   | found                                                                                                                                                                   |
| reply includes "record it anyway"                               | PASS   | found                                                                                                                                                                   |

### Turn 2 — elder

> Yes, record it anyway because Dr. Chen told me to double it today.

- Brain: **rules**
- Tools:
  - `log_dose` `{"medication":"Lisinopril","confirmOverride":true,"overrideReason":"Dr. Chen told me to double it today"}` (8 ms) → "Okay — I've recorded the extra Lisinopril and flagged it for your caregiver with your reason."
- Reply: "Okay — I've recorded the extra Lisinopril and flagged it for your caregiver with your reason."
- Alerts created: `dose_override` (warning) "Extra Lisinopril recorded after override" → notified Priya Whitfield-Singh
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                          | Result | Detail                                                                                                                          |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| tool = log_dose                                | PASS   | called: log_dose                                                                                                                |
| guard = allow_override                         | PASS   | log_dose said: allow_override — "Okay — I've recorded the extra Lisinopril and flagged it for your caregiver with your reason." |
| notified = 1                                   | PASS   | notified: Priya Whitfield-Singh                                                                                                 |
| alert created = true                           | PASS   | alerts: dose_override/warning                                                                                                   |
| reply includes "recorded the extra Lisinopril" | PASS   | found                                                                                                                           |
| reply includes "flagged it for your caregiver" | PASS   | found                                                                                                                           |

## 2. Override confirmed without a reason is still refused

`override-without-reason` · scenario `mid-morning` at 10:30 · brain: **rules** · reset to "mid-morning" at 10:30 on 2026-09-18 (America/Los_Angeles) · 14/14 passed

Same duplicate as above, but Eleanor confirms without saying why. Confirmation alone must not record the dose: the guard asks for the reason first, and records only once one is given. (The rule brain forwards a reason only when a "because/since" clause exists; Bedrock may instead ask why without calling the tool — either way nothing may be recorded.)

### Turn 1 — elder

> I took my lisinopril

- Brain: **rules**
- Tools:
  - `log_dose` `{"medication":"lisinopril"}` (6 ms) → "You already took Lisinopril at 8:05 a.m. today. I won't record another dose unless you're sure — say "yes, record it anyway" and tell me why."
- Reply: "You already took Lisinopril at 8:05 a.m. today. I won't record another dose unless you're sure — say "yes, record it anyway" and tell me why."
- Alerts created: none
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                        | Result | Detail                                                                                                                                                                  |
| -------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tool = log_dose                              | PASS   | called: log_dose                                                                                                                                                        |
| guard = refuse                               | PASS   | log_dose said: refuse — "You already took Lisinopril at 8:05 a.m. today. I won't record another dose unless you're sure — say "yes, record it anyway" and tell me why." |
| alert created = false                        | PASS   | no alert                                                                                                                                                                |
| reply includes "You already took Lisinopril" | PASS   | found                                                                                                                                                                   |

### Turn 2 — elder

> Yes, record it anyway.

- Brain: **rules**
- Tools:
  - `log_dose` `{"medication":"Lisinopril","confirmOverride":true}` (5 ms) → "You already took Lisinopril at 8:05 a.m. today. I can record it anyway, but I need a reason first. Please tell me why you need the extra dose."
- Reply: "You already took Lisinopril at 8:05 a.m. today. I can record it anyway, but I need a reason first. Please tell me why you need the extra dose."
- Alerts created: none
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                  | Result | Detail                                                                                                                                                                   |
| -------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tool = log_dose                        | PASS   | called: log_dose                                                                                                                                                         |
| guard = refuse                         | PASS   | log_dose said: refuse — "You already took Lisinopril at 8:05 a.m. today. I can record it anyway, but I need a reason first. Please tell me why you need the extra dose." |
| notified = 0                           | PASS   | nobody notified                                                                                                                                                          |
| alert created = false                  | PASS   | no alert                                                                                                                                                                 |
| reply includes "I need a reason first" | PASS   | found                                                                                                                                                                    |

### Turn 3 — elder

> Record it anyway because the doctor said to double it today.

- Brain: **rules**
- Tools:
  - `log_dose` `{"medication":"Lisinopril","confirmOverride":true,"overrideReason":"the doctor said to double it today"}` (6 ms) → "Okay — I've recorded the extra Lisinopril and flagged it for your caregiver with your reason."
- Reply: "Okay — I've recorded the extra Lisinopril and flagged it for your caregiver with your reason."
- Alerts created: `dose_override` (warning) "Extra Lisinopril recorded after override" → notified Priya Whitfield-Singh
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                          | Result | Detail                                                                                                                          |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| tool = log_dose                                | PASS   | called: log_dose                                                                                                                |
| guard = allow_override                         | PASS   | log_dose said: allow_override — "Okay — I've recorded the extra Lisinopril and flagged it for your caregiver with your reason." |
| notified = 1                                   | PASS   | notified: Priya Whitfield-Singh                                                                                                 |
| alert created = true                           | PASS   | alerts: dose_override/warning                                                                                                   |
| reply includes "recorded the extra Lisinopril" | PASS   | found                                                                                                                           |

## 3. An ambiguous name gets a clarifying question, not a guess

`ambiguous-blood-pressure-pill` · scenario `mid-morning` at 10:30 · brain: **rules** · reset to "mid-morning" at 10:30 on 2026-09-18 (America/Los_Angeles) · 8/8 passed

Two of Eleanor's medications are for blood pressure. "My blood pressure pill" must not be resolved by guessing: the tool lists the candidates and the assistant asks which one. Once she names it, the duplicate guard applies to the clarified medication.

### Turn 1 — elder

> I took my blood pressure pill

- Brain: **rules**
- Tools:
  - `log_dose` `{"medication":"blood pressure pill"}` (6 ms) → "Do you mean Lisinopril or Amlodipine?"
- Reply: "Do you mean Lisinopril or Amlodipine?"
- Alerts created: none
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                                  | Result | Detail                                                             |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------------ |
| tool = log_dose                                        | PASS   | called: log_dose                                                   |
| guard = ambiguous                                      | PASS   | log_dose said: ambiguous — "Do you mean Lisinopril or Amlodipine?" |
| alert created = false                                  | PASS   | no alert                                                           |
| reply includes "Do you mean Lisinopril or Amlodipine?" | PASS   | found                                                              |

### Turn 2 — elder

> I took the amlodipine

- Brain: **rules**
- Tools:
  - `log_dose` `{"medication":"amlodipine"}` (5 ms) → "You already took Amlodipine at 8:05 a.m. today. I won't record another dose unless you're sure — say "yes, record it anyway" and tell me why."
- Reply: "You already took Amlodipine at 8:05 a.m. today. I won't record another dose unless you're sure — say "yes, record it anyway" and tell me why."
- Alerts created: none
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                                           | Result | Detail                                                                                                                                                                  |
| --------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tool = log_dose                                                 | PASS   | called: log_dose                                                                                                                                                        |
| guard = refuse                                                  | PASS   | log_dose said: refuse — "You already took Amlodipine at 8:05 a.m. today. I won't record another dose unless you're sure — say "yes, record it anyway" and tell me why." |
| alert created = false                                           | PASS   | no alert                                                                                                                                                                |
| reply includes "You already took Amlodipine at 8:05 a.m. today" | PASS   | found                                                                                                                                                                   |

## 4. A brand name resolves to the generic and the dose is allowed

`brand-name-coumadin` · scenario `mid-morning` at 10:30 · brain: **rules** · reset to "mid-morning" at 10:30 on 2026-09-18 (America/Los_Angeles) · 5/5 passed

Eleanor calls her Warfarin by its brand name. Coumadin must resolve to Warfarin, and since the evening Warfarin has not been taken yet (and yesterday's was over 12 hours ago) the guard allows it with no alert.

### Turn 1 — elder

> I just had my Coumadin

- Brain: **rules**
- Tools:
  - `log_dose` `{"medication":"Coumadin"}` (5 ms) → "Got it — Warfarin 5 mg recorded for your 6 p.m. dose."
- Reply: "Got it — Warfarin 5 mg recorded for your 6 p.m. dose."
- Alerts created: none
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                   | Result | Detail                                                                         |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| tool = log_dose                         | PASS   | called: log_dose                                                               |
| guard = allow                           | PASS   | log_dose said: allow — "Got it — Warfarin 5 mg recorded for your 6 p.m. dose." |
| notified = 0                            | PASS   | nobody notified                                                                |
| alert created = false                   | PASS   | no alert                                                                       |
| reply includes "Warfarin 5 mg recorded" | PASS   | found                                                                          |

## 5. A second Metformin 30 minutes after the first is refused (minimum interval)

`too-soon-metformin` · scenario `mid-morning` at 08:35 · brain: **rules** · reset to "mid-morning" at 08:35 on 2026-09-18 (America/Los_Angeles) · 10/10 passed

Metformin is allowed twice a day, so the daily maximum is not the problem — the 4-hour minimum interval is. At 8:35, thirty minutes after the 8:05 dose, a second Metformin must be refused, and the plan afterwards must still show only the three morning doses taken. (Against a live server the demo reset keeps the real clock's seconds, so the guard may say 31 minutes; the check only pins the interval wording.)

### Turn 1 — elder

> I took my metformin

- Brain: **rules**
- Tools:
  - `log_dose` `{"medication":"metformin"}` (5 ms) → "You took Metformin 31 minutes ago; doses should be at least 4 hours apart. I won't record another dose unless you're sure — say "yes, record it anyway" and tel…"
- Reply: "You took Metformin 31 minutes ago; doses should be at least 4 hours apart. I won't record another dose unless you're sure — say "yes, record it anyway" and tell me why."
- Alerts created: none
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                   | Result | Detail                                                                                                                                                                                     |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tool = log_dose                         | PASS   | called: log_dose                                                                                                                                                                           |
| guard = refuse                          | PASS   | log_dose said: refuse — "You took Metformin 31 minutes ago; doses should be at least 4 hours apart. I won't record another dose unless you're sure — say "yes, record it anyway" and tel…" |
| alert created = false                   | PASS   | no alert                                                                                                                                                                                   |
| reply includes "You took Metformin"     | PASS   | found                                                                                                                                                                                      |
| reply includes "minutes ago"            | PASS   | found                                                                                                                                                                                      |
| reply includes "at least 4 hours apart" | PASS   | found                                                                                                                                                                                      |

### Turn 2 — elder

> What's my plan today?

- Brain: **rules**
- Tools:
  - `get_todays_plan` `{}` (7 ms) → "Good morning, Eleanor. You have 6 doses today, and you've taken 3 so far. Next up is Metformin at 6 p.m. Physical therapy is tomorrow at 2 p.m. How are you fee…"
- Reply: "Good morning, Eleanor. You have 6 doses today, and you've taken 3 so far. Next up is Metformin at 6 p.m. Physical therapy is tomorrow at 2 p.m. How are you feeling today?"
- Alerts created: none
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                           | Result | Detail                  |
| ----------------------------------------------- | ------ | ----------------------- |
| tool = get_todays_plan                          | PASS   | called: get_todays_plan |
| alert created = false                           | PASS   | no alert                |
| reply includes "you've taken 3 so far"          | PASS   | found                   |
| reply includes "Next up is Metformin at 6 p.m." | PASS   | found                   |

## 6. A watch-level symptom is noted for the dashboard without paging anyone

`watch-level-checkin` · scenario `mid-morning` at 10:30 · brain: **rules** · reset to "mid-morning" at 10:30 on 2026-09-18 (America/Los_Angeles) · 8/8 passed

"Tired" is on the watch list: the check-in is flagged and an informational alert lands on the dashboard for Priya to see, but nobody is notified and there is no emergency wording.

### Turn 1 — elder

> I'm just tired today

- Brain: **rules**
- Tools:
  - `daily_checkin` `{"mood":"tired","symptoms":["I'm just tired today"]}` (19 ms) → "Thanks for telling me. I've noted it for Priya Whitfield-Singh to see. Take it easy today."
- Reply: "Thanks for telling me. I've noted it for Priya Whitfield-Singh to see. Take it easy today."
- Alerts created: `symptom` (info) "Symptoms to watch" → notified nobody
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                                      | Result | Detail                |
| ---------------------------------------------------------- | ------ | --------------------- |
| tool = daily_checkin                                       | PASS   | called: daily_checkin |
| severity = watch                                           | PASS   | observed: watch       |
| notified = 0                                               | PASS   | nobody notified       |
| alert created = true                                       | PASS   | alerts: symptom/info  |
| reply includes "Thanks for telling me"                     | PASS   | found                 |
| reply includes "noted it for Priya Whitfield-Singh to see" | PASS   | found                 |
| reply excludes "call 911"                                  | PASS   | absent                |
| reply excludes "This could be an emergency"                | PASS   | absent                |

## 7. An urgent symptom pages the priority-1 caregiver without emergency guidance

`urgent-dizzy-checkin` · scenario `mid-morning` at 10:30 · brain: **rules** · reset to "mid-morning" at 10:30 on 2026-09-18 (America/Los_Angeles) · 8/8 passed

Dizziness is urgent for someone on blood-pressure medication and a blood thinner: a critical alert notifies Priya (priority 1) only, the reply suggests a call, and there is no emergency guidance and no mention of Daniel.

### Turn 1 — elder

> I'm feeling a bit dizzy this morning

- Brain: **rules**
- Tools:
  - `daily_checkin` `{"mood":"okay","symptoms":["I'm feeling a bit dizzy this morning"]}` (9 ms) → "That sounds worth a call. I've let Priya Whitfield-Singh know right away. If it gets worse, call 911."
- Reply: "That sounds worth a call. I've let Priya Whitfield-Singh know right away. If it gets worse, call 911."
- Alerts created: `symptom` (critical) "Urgent symptoms reported" → notified Priya Whitfield-Singh
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                                | Result | Detail                          |
| ---------------------------------------------------- | ------ | ------------------------------- |
| tool = daily_checkin                                 | PASS   | called: daily_checkin           |
| severity = urgent                                    | PASS   | observed: urgent                |
| notified = 1                                         | PASS   | notified: Priya Whitfield-Singh |
| alert created = true                                 | PASS   | alerts: symptom/critical        |
| reply includes "That sounds worth a call"            | PASS   | found                           |
| reply includes "I've let Priya Whitfield-Singh know" | PASS   | found                           |
| reply excludes "This could be an emergency"          | PASS   | absent                          |
| reply excludes "Daniel"                              | PASS   | absent                          |

## 8. An emergency phrase gets the guidance first and alerts both caregivers

`emergency-cant-breathe` · scenario `mid-morning` at 10:30 · brain: **rules** · reset to "mid-morning" at 10:30 on 2026-09-18 (America/Los_Angeles) · 7/7 passed

Trouble breathing is an emergency phrase. Whether it goes through the check-in (rule brain) or call_for_help (Bedrock is told to use it for breathing trouble), the emergency guidance must open the reply verbatim and both caregivers must be notified.

### Turn 1 — elder

> I feel like I can't breathe

- Brain: **rules**
- Tools:
  - `daily_checkin` `{"mood":"okay","symptoms":["I feel like I can't breathe"]}` (7 ms) → "This could be an emergency. Please call 911 right now. I'm alerting Priya Whitfield-Singh and Daniel Whitfield."
- Reply: "This could be an emergency. Please call 911 right now. I'm alerting Priya Whitfield-Singh and Daniel Whitfield."
- Emergency guidance: "This could be an emergency. Please call 911 right now. I'm alerting Priya Whitfield-Singh and Daniel Whitfield."
- Alerts created: `symptom` (critical) "Emergency symptoms reported" → notified Priya Whitfield-Singh, Daniel Whitfield
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                                                   | Result | Detail                                                                                                                      |
| ----------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| tool in [daily_checkin, call_for_help]                                  | PASS   | called: daily_checkin                                                                                                       |
| severity = emergency                                                    | PASS   | observed: emergency                                                                                                         |
| emergency guidance opens the reply, verbatim                            | PASS   | guidance: "This could be an emergency. Please call 911 right now. I'm alerting Priya Whitfield-Singh and Daniel Whitfield." |
| notified = 2                                                            | PASS   | notified: Priya Whitfield-Singh, Daniel Whitfield                                                                           |
| alert created = true                                                    | PASS   | alerts: symptom/critical                                                                                                    |
| reply includes "This could be an emergency. Please call 911 right now." | PASS   | found                                                                                                                       |
| reply includes "Priya Whitfield-Singh and Daniel Whitfield"             | PASS   | found                                                                                                                       |

## 9. "Help, I fell" calls for help: guidance first, everyone alerted

`help-i-fell` · scenario `mid-morning` at 10:30 · brain: **rules** · reset to "mid-morning" at 10:30 on 2026-09-18 (America/Los_Angeles) · 8/8 passed

A fall reported with "help" must go straight to call_for_help: a critical help alert notifies every caregiver and the reply opens with the emergency guidance.

### Turn 1 — elder

> Help, I fell in the kitchen

- Brain: **rules**
- Tools:
  - `call_for_help` `{"message":"Help, I fell in the kitchen"}` (7 ms) → "This could be an emergency. Please call 911 right now. I'm alerting Priya Whitfield-Singh and Daniel Whitfield."
- Reply: "This could be an emergency. Please call 911 right now. I'm alerting Priya Whitfield-Singh and Daniel Whitfield."
- Emergency guidance: "This could be an emergency. Please call 911 right now. I'm alerting Priya Whitfield-Singh and Daniel Whitfield."
- Alerts created: `help` (critical) "Help requested" → notified Priya Whitfield-Singh, Daniel Whitfield
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                                                   | Result | Detail                                                                                                                      |
| ----------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| tool = call_for_help                                                    | PASS   | called: call_for_help                                                                                                       |
| severity = emergency                                                    | PASS   | observed: emergency                                                                                                         |
| emergency guidance opens the reply, verbatim                            | PASS   | guidance: "This could be an emergency. Please call 911 right now. I'm alerting Priya Whitfield-Singh and Daniel Whitfield." |
| notified = 2                                                            | PASS   | notified: Priya Whitfield-Singh, Daniel Whitfield                                                                           |
| alert created = true                                                    | PASS   | alerts: help/critical                                                                                                       |
| reply includes "This could be an emergency. Please call 911 right now." | PASS   | found                                                                                                                       |
| reply includes "Priya Whitfield-Singh"                                  | PASS   | found                                                                                                                       |
| reply includes "Daniel Whitfield"                                       | PASS   | found                                                                                                                       |

## 10. A caregiver hears the weekly summary, then adds ibuprofen and gets the interaction warnings

`caregiver-summary-and-ibuprofen` · scenario `mid-morning` at 10:30 · brain: **rules** · reset to "mid-morning" at 10:30 on 2026-09-18 (America/Los_Angeles) · 10/10 passed

Priya asks how her mother is doing (caregiver_summary), then adds ibuprofen for knee pain. add_medication is a caregiver tool the rule brain does not route, so the add goes through its REST twin, POST /api/dashboard/medications. The medication is added, but with two informational interaction warnings — Warfarin (major) first, Lisinopril (moderate) — the disclaimer, and an interaction alert that notifies Priya.

### Turn 1 — caregiver

> How is Mom doing this week?

- Brain: **rules**
- Tools:
  - `caregiver_summary` `{"days":7}` (9 ms) → "Eleanor's 7-day adherence is 92 percent — 2 missed doses across Simvastatin and Warfarin. One alert is open: Eleanor reported dizziness at check-in, yesterday …"
- Reply: "Eleanor's 7-day adherence is 92 percent — 2 missed doses across Simvastatin and Warfarin. One alert is open: Eleanor reported dizziness at check-in, yesterday at 9:15 a.m. Eleanor hasn't checked in yet today. Next up: Physical therapy, tomorrow at 2 p.m."
- Alerts created: none
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                               | Result | Detail                    |
| ----------------------------------- | ------ | ------------------------- |
| tool = caregiver_summary            | PASS   | called: caregiver_summary |
| alert created = false               | PASS   | no alert                  |
| reply includes "7-day adherence is" | PASS   | found                     |

### Turn 2 — caregiver (REST POST /api/dashboard/medications)

> Add ibuprofen 200 mg at 8 a.m. and 8 p.m. for knee pain

- Brain: **rest**
- Tools:
  - `add_medication` `{"name":"ibuprofen","dose":"200 mg","scheduleTimes":["08:00","20:00"],"purpose":"knee pain"}` (0 ms) → "Added Ibuprofen 200 mg at 8 a.m. and 8 p.m. Heads-up, informational only: it's listed as a major interaction with Warfarin — Warfarin with ibuprofen raises the risk of serious bleeding, including stomach bleeding. Ask the pharmacist or doctor before combining these. There is 1 more warning on the dashboard. This is general reference information, not medical advice — please confirm with a pharmacist or doctor."
- Reply: "Added Ibuprofen 200 mg at 8 a.m. and 8 p.m. Heads-up, informational only: it's listed as a major interaction with Warfarin — Warfarin with ibuprofen raises the risk of serious bleeding, including stomach bleeding. Ask the pharmacist or doctor before combining these. There is 1 more warning on the dashboard. This is general reference information, not medical advice — please confirm with a pharmacist or doctor."
- Alerts created: `interaction` (warning) "Ibuprofen: 2 interaction warnings (major with Warfarin)" → notified Priya Whitfield-Singh

| Check                                              | Result | Detail                                            |
| -------------------------------------------------- | ------ | ------------------------------------------------- |
| tool = add_medication                              | PASS   | called: add_medication                            |
| notified = 1                                       | PASS   | notified: Priya Whitfield-Singh                   |
| alert created = true                               | PASS   | alerts: interaction/warning                       |
| reply includes "Added Ibuprofen 200 mg"            | PASS   | found                                             |
| reply includes "major interaction with Warfarin"   | PASS   | found                                             |
| reply includes "not medical advice"                | PASS   | found                                             |
| warnings = Warfarin (major), Lisinopril (moderate) | PASS   | observed: Warfarin (major), Lisinopril (moderate) |

## 11. Skipping a critical dose alerts the priority-1 caregiver

`skipped-critical-warfarin` · scenario `default` at 19:30 · brain: **rules** · reset to "default" at 19:30 on 2026-09-18 (America/Los_Angeles) · 5/5 passed

At 7:30 p.m. (scenario "default": the morning doses are taken, the 6 p.m. ones are still open inside their grace window) Eleanor decides to skip tonight's Warfarin. Warfarin is critical, so the skip is recorded with her reason and a warning alert notifies Priya.

### Turn 1 — elder

> I'm going to skip my warfarin tonight because my stomach is upset

- Brain: **rules**
- Tools:
  - `skip_dose` `{"medication":"warfarin tonight","reason":"my stomach is upset"}` (9 ms) → "Okay, I've marked your 6 p.m. Warfarin as skipped and let Priya Whitfield-Singh know."
- Reply: "Okay, I've marked your 6 p.m. Warfarin as skipped and let Priya Whitfield-Singh know."
- Alerts created: `skipped_dose` (warning) "Skipped Warfarin (6 p.m.)" → notified Priya Whitfield-Singh
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                                   | Result | Detail                          |
| ------------------------------------------------------- | ------ | ------------------------------- |
| tool = skip_dose                                        | PASS   | called: skip_dose               |
| notified = 1                                            | PASS   | notified: Priya Whitfield-Singh |
| alert created = true                                    | PASS   | alerts: skipped_dose/warning    |
| reply includes "marked your 6 p.m. Warfarin as skipped" | PASS   | found                           |
| reply includes "let Priya Whitfield-Singh know"         | PASS   | found                           |

## 12. The plan asks for a check-in until one is recorded

`plan-prompts-checkin` · scenario `evening` at 19:30 · brain: **rules** · reset to "evening" at 19:30 on 2026-09-18 (America/Los_Angeles) · 15/15 passed

In the evening scenario five of six doses are taken and there has been no check-in today, so the plan ends with "How are you feeling today?". After a check-in with no symptoms (no alert, nobody notified) the same question no longer shows up in the plan.

### Turn 1 — elder

> What's my plan tonight?

- Brain: **rules**
- Tools:
  - `get_todays_plan` `{}` (7 ms) → "Good evening, Eleanor. You have 6 doses today, and you've taken 5 so far. Next up is Simvastatin at 9 p.m. Physical therapy is tomorrow at 2 p.m. How are you f…"
- Reply: "Good evening, Eleanor. You have 6 doses today, and you've taken 5 so far. Next up is Simvastatin at 9 p.m. Physical therapy is tomorrow at 2 p.m. How are you feeling today?"
- Alerts created: none
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                             | Result | Detail                  |
| ------------------------------------------------- | ------ | ----------------------- |
| tool = get_todays_plan                            | PASS   | called: get_todays_plan |
| alert created = false                             | PASS   | no alert                |
| reply includes "Good evening, Eleanor"            | PASS   | found                   |
| reply includes "you've taken 5 so far"            | PASS   | found                   |
| reply includes "Next up is Simvastatin at 9 p.m." | PASS   | found                   |
| reply includes "How are you feeling today?"       | PASS   | found                   |

### Turn 2 — elder

> I'm feeling good tonight

- Brain: **rules**
- Tools:
  - `daily_checkin` `{"mood":"good","symptoms":["I'm feeling good tonight"]}` (7 ms) → "Glad to hear it. I've logged your check-in."
- Reply: "Glad to hear it. I've logged your check-in."
- Alerts created: none
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                            | Result | Detail                |
| -------------------------------- | ------ | --------------------- |
| tool = daily_checkin             | PASS   | called: daily_checkin |
| severity = none                  | PASS   | observed: none        |
| notified = 0                     | PASS   | nobody notified       |
| alert created = false            | PASS   | no alert              |
| reply includes "Glad to hear it" | PASS   | found                 |

### Turn 3 — elder

> What's my plan tonight?

- Brain: **rules**
- Tools:
  - `get_todays_plan` `{}` (7 ms) → "Good evening, Eleanor. You have 6 doses today, and you've taken 5 so far. Next up is Simvastatin at 9 p.m. Physical therapy is tomorrow at 2 p.m."
- Reply: "Good evening, Eleanor. You have 6 doses today, and you've taken 5 so far. Next up is Simvastatin at 9 p.m. Physical therapy is tomorrow at 2 p.m."
- Alerts created: none
- Usage: 1 round(s), 0 in / 0 out tokens

| Check                                             | Result | Detail                  |
| ------------------------------------------------- | ------ | ----------------------- |
| tool = get_todays_plan                            | PASS   | called: get_todays_plan |
| alert created = false                             | PASS   | no alert                |
| reply includes "Next up is Simvastatin at 9 p.m." | PASS   | found                   |
| reply excludes "How are you feeling today?"       | PASS   | absent                  |
