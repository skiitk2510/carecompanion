/**
 * Settings of the classic Alexa Skill endpoint, read straight from the environment (they are not part of the app
 * `Config`, so the skill stays an optional add-on).
 *
 *  - ALEXA_SKILL              `on` (default) | `off` — `off` leaves POST /alexa unmounted.
 *  - ALEXA_SKILL_ID           optional `amzn1.ask.skill.…`; when set, requests for any other skill id are rejected.
 *  - ALEXA_VERIFY_SIGNATURE   `true` (default) — verify Amazon's request signature; `false` only for local tests.
 *  - ALEXA_VERIFY_TIMESTAMP   `true` (default) — reject requests older than 150 s; `false` only for local tests.
 *  - ALEXA_AGENT_TIMEOUT_MS   how long one turn may wait for the agent before answering "give me a moment"
 *                             (default 7000; Alexa itself gives the endpoint about 8 s).
 */

export interface AlexaConfig {
  enabled: boolean;
  skillId: string | undefined;
  verifySignature: boolean;
  verifyTimestamp: boolean;
  agentTimeoutMs: number;
}

export const DEFAULT_AGENT_TIMEOUT_MS = 7_000;

export function loadAlexaConfig(env: NodeJS.ProcessEnv = process.env): AlexaConfig {
  return {
    enabled: !['off', 'false', '0', 'no'].includes((env.ALEXA_SKILL ?? 'on').trim().toLowerCase()),
    skillId: env.ALEXA_SKILL_ID?.trim() || undefined,
    verifySignature: flag(env.ALEXA_VERIFY_SIGNATURE, true),
    verifyTimestamp: flag(env.ALEXA_VERIFY_TIMESTAMP, true),
    agentTimeoutMs: positiveInt(env.ALEXA_AGENT_TIMEOUT_MS, DEFAULT_AGENT_TIMEOUT_MS),
  };
}

/** Only an explicit `false`/`0`/`no`/`off` switches a safety check off; anything else keeps the default. */
function flag(value: string | undefined, fallback: boolean): boolean {
  const v = (value ?? '').trim().toLowerCase();
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  return fallback;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
