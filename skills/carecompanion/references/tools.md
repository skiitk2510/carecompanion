# CareCompanion tool cheat-sheet

All tools accept an optional `elderId` (omit for the household elder) and return spoken `content[0].text` plus
`structuredContent`. Times are `HH:mm` in the household timezone; instants are ISO 8601 UTC.

| Tool                | Speaker   | Arguments                                                                                                                                          | Structured result (highlights)                                                                                                       |
| ------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `get_todays_plan`   | elder     | —                                                                                                                                                  | `doses[]` (status scheduled/taken/late/missed/skipped), `nextUp`, `appointments[]`, `checkedInToday`, `openAlertsCount`              |
| `log_dose`          | elder     | `medication` (as spoken), `takenAt?`, `confirmOverride?`, `overrideReason?`                                                                        | `verdict` allow/refuse/allow_override/ambiguous/not_found, `requiresConfirmation`, `reason`, `lastTakenAt`, `candidates?`, `alertId` |
| `skip_dose`         | elder     | `medication`, `reason?`                                                                                                                            | `verdict` skipped/ambiguous/not_found/nothing_due, `scheduledTime`, `alertId`                                                        |
| `daily_checkin`     | elder     | `mood`, `symptoms?[]`, `notes?`                                                                                                                    | `severity` none/watch/urgent/emergency, `notified[]`, `emergencyGuidance?`, `alertIds[]`                                             |
| `call_for_help`     | elder     | `message?`                                                                                                                                         | `alertId`, `notified[]`, `emergencyGuidance` (say verbatim)                                                                          |
| `add_medication`    | caregiver | `name`, `dose`, `scheduleTimes[]`, `form?`, `purpose?`, `instructions?`, `critical?`, `maxDailyDoses?`, `minIntervalMin?`, `graceMin?`, `addedBy?` | `medication`, `warnings[]` {kind, withName, severity minor/moderate/major, summary, advice, disclaimer}, `alertId`                   |
| `caregiver_summary` | caregiver | `days?` 7 or 30                                                                                                                                    | the full dashboard payload (adherence, today's doses, open alerts, check-in trend, appointments); renders as an MCP App              |
| `resolve_alert`     | caregiver | `alertId`, `caregiverId`, `action` acknowledge/resolve, `resolution?`                                                                              | `alert` {acknowledgedBy, resolvedBy, resolution}, `changed`                                                                          |

## Resource

`carecompanion://elder/{elderId}/adherence` — JSON with 7- and 30-day windows: due / taken / late / missed /
skipped, rate, per-day and per-medication breakdowns. Listed under `resources/list` for each elder.

## Prompt

`morning_briefing` (`elderId?`) — a host-side template: call `get_todays_plan`, speak three short sentences, ask one
gentle check-in question.

## Spoken examples

- Plan: "Good morning, Eleanor. You have 6 doses today, and you've taken 3 so far. Next up is Metformin at 6 p.m.
  Physical therapy is tomorrow at 2 p.m. How are you feeling today?"
- Guard refusal: "You already took Lisinopril at 8:05 a.m. today. I won't record another dose unless you're sure —
  say \"yes, record it anyway\" and tell me why."
- Override: "Okay — I've recorded the extra Lisinopril and flagged it for your caregiver with your reason."
- Urgent check-in: "That sounds worth a call. I've let Priya Whitfield-Singh know right away. If it gets worse, call 911."
- Emergency: "This could be an emergency. Please call 911 right now. I'm alerting Priya Whitfield-Singh and Daniel Whitfield."
- Add medication: "Added Ibuprofen 200 mg at 8 a.m. and 8 p.m. Heads-up, informational only: it's listed as a major
  interaction with Warfarin — … Please confirm with a pharmacist or doctor."
