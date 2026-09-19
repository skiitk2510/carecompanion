# CareCompanion privacy policy

_Effective date: 2026-09-19_

CareCompanion is an open-source demonstration project (MIT license) built for the Build, Ship, Shape: Amazon Developer
Hackathon. This page explains, in plain language, what the CareCompanion Alexa+ add-on and its demo server do with
information.

## The short version

- There are no accounts, sign-ups or profiles.
- The household in the demo is fictional: Eleanor Whitfield, 78, and her family caregivers Priya Whitfield-Singh and
  Daniel Whitfield. Nothing in it is real patient data.
- We do not collect, store or sell personal data. Please do not enter real health information into the demo.
- Requests are logged briefly for debugging and are not shared with anyone.

## What the add-on receives

When Alexa+ (or any other MCP host) uses CareCompanion, the server receives the tool calls the host decides to make:
for example the name of a medication as you said it, a mood word, a symptom description, or a note on an alert. The
server never receives audio; your voice is handled by Amazon under Amazon's own privacy notice.

## What happens to it

- Tool arguments are applied to the demo household, which lives only in the server's memory and is reset to its
  synthetic starting state on every restart. There is no database.
- The server writes operational logs (timestamps, tool names, error messages and, for failed requests, enough of the
  request to debug it) to the hosting provider's log stream. Logs are used only to keep the demo working and are kept
  only for the short window the hosting provider retains process logs. We do not export, analyse or share them.
- The demo website at the same host (the "simulated Alexa+ experience") sends the text of what you type or say to
  Amazon Bedrock to generate a reply. That text is used only to produce the reply and is not stored by CareCompanion
  beyond the current session; under Amazon's Bedrock terms, prompts are not used to train models.

## What we do not do

- No accounts, no passwords, no account linking.
- No tracking cookies, no analytics, no advertising, no purchases.
- No sharing or selling of data with anyone beyond the hosting and AI providers that run the demo, and never for their
  own purposes.
- Nothing is directed at children; the add-on is intended for adults and their family caregivers.
- Caregiver "notifications" in the demo are recorded on the alert and written to the log. No SMS, email or phone call
  is sent to anyone.

## Your choices

Because nothing is stored, there is nothing to export or delete: restarting the server (which happens automatically on
the free hosting tier) wipes the household. If you want to run CareCompanion with your own data, host it yourself from
the source code and apply your own privacy practices.

## Changes and contact

We will update this page if the demo changes what it does with data; the effective date above tells you when. For
questions, open an issue at <https://github.com/skiitk2510/carecompanion/issues>.
