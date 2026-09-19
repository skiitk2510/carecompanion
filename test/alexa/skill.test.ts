import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routeIntent, slotText, stripMarkdown, toSpeech } from '../../src/alexa/handlers.js';
import {
  rawRequest,
  startTestServer,
  waitFor,
  type TestServer,
  type TestServerOptions,
} from '../helpers/testServer.js';

const APP_ID = 'amzn1.ask.skill.00000000-0000-0000-0000-000000000000';
const USER_ID = 'amzn1.ask.account.TEST';
const VERIFY_OFF = { ALEXA_VERIFY_SIGNATURE: 'false', ALEXA_VERIFY_TIMESTAMP: 'false' };
const VERIFY_ON = { ALEXA_VERIFY_SIGNATURE: 'true', ALEXA_VERIFY_TIMESTAMP: 'true' };

/**
 * src/alexa/config.ts reads process.env directly (the app Config does not carry the Alexa settings), so the
 * variables are set for the duration of the boot and restored afterwards. Every test file runs in its own worker.
 */
async function startSkillServer(
  alexaEnv: Record<string, string> = {},
  opts: TestServerOptions = {}
): Promise<TestServer> {
  const env: Record<string, string> = {
    ALEXA_SKILL: 'on',
    ALEXA_SKILL_ID: '',
    ALEXA_AGENT_TIMEOUT_MS: '',
    ...VERIFY_OFF,
    ...alexaEnv,
  };
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    saved.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await startTestServer(opts);
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

interface EnvelopeOptions {
  attributes?: Record<string, unknown>;
  apl?: boolean;
  newSession?: boolean;
  timestamp?: string;
  applicationId?: string;
}

interface SkillResponse {
  version: string;
  sessionAttributes?: Record<string, unknown>;
  response: {
    outputSpeech?: { type: string; text?: string; ssml?: string };
    reprompt?: { outputSpeech: { type: string; text?: string } };
    card?: { type: string; title: string; content: string };
    directives?: Array<{ type: string; token?: string; document?: Record<string, unknown>; datasources?: any }>;
    shouldEndSession?: boolean;
  };
}

let requestCounter = 0;

/** A hand-built Alexa request envelope, shaped like the developer console's Skill I/O "JSON Input". */
function envelope(request: Record<string, unknown>, opts: EnvelopeOptions = {}) {
  const applicationId = opts.applicationId ?? APP_ID;
  const supportedInterfaces = opts.apl ? { 'Alexa.Presentation.APL': { runtime: { maxVersion: '2023.3' } } } : {};
  return {
    version: '1.0',
    session: {
      new: opts.newSession ?? false,
      sessionId: 'amzn1.echo-api.session.TEST',
      application: { applicationId },
      user: { userId: USER_ID },
      attributes: opts.attributes ?? {},
    },
    context: {
      System: {
        application: { applicationId },
        user: { userId: USER_ID },
        device: { deviceId: 'amzn1.ask.device.TEST', supportedInterfaces },
        apiEndpoint: 'https://api.amazonalexa.com',
        apiAccessToken: 'test-token',
      },
    },
    request: {
      requestId: `amzn1.echo-api.request.${++requestCounter}`,
      timestamp: opts.timestamp ?? new Date().toISOString(),
      locale: 'en-US',
      ...request,
    },
  };
}

function launch(opts: EnvelopeOptions = {}) {
  return envelope({ type: 'LaunchRequest' }, { newSession: true, ...opts });
}

function intent(name: string, slots: Record<string, string> = {}, opts: EnvelopeOptions = {}) {
  const slotObjects = Object.fromEntries(
    Object.entries(slots).map(([slot, value]) => [slot, { name: slot, value, confirmationStatus: 'NONE' }])
  );
  return envelope({ type: 'IntentRequest', intent: { name, confirmationStatus: 'NONE', slots: slotObjects } }, opts);
}

async function post(srv: TestServer, body: unknown, headers: Record<string, string> = {}) {
  const res = await rawRequest(`${srv.baseUrl}/alexa`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, contentType: String(res.headers['content-type'] ?? ''), body: res.body };
}

/** POST an envelope and parse the skill's JSON response (asserting the HTTP layer first). */
async function skill(srv: TestServer, body: unknown): Promise<SkillResponse> {
  const res = await post(srv, body);
  expect(res.status, res.body).toBe(200);
  expect(res.contentType).toContain('application/json');
  return JSON.parse(res.body) as SkillResponse;
}

function speech(json: SkillResponse): string {
  expect(json.response.outputSpeech?.type).toBe('PlainText');
  return json.response.outputSpeech?.text ?? '';
}

describe('intent → utterance mapping (pure)', () => {
  it('rebuilds the sentences the rule brain routes like the web demo', () => {
    expect(routeIntent('PlanIntent', {})).toEqual({
      kind: 'agent',
      utterance: "what's my plan today",
      speaker: 'elder',
    });
    expect(routeIntent('TookIntent', { medication: 'lisinopril' })).toEqual({
      kind: 'agent',
      utterance: 'I took my lisinopril',
      speaker: 'elder',
    });
    expect(routeIntent('OverrideIntent', { reason: 'because the doctor said so' })).toMatchObject({
      utterance: 'yes, record it anyway because the doctor said so',
    });
    expect(routeIntent('SkipIntent', { medication: 'metformin' })).toMatchObject({ utterance: 'skip my metformin' });
    expect(routeIntent('FeelingIntent', { feeling: 'a bit dizzy' })).toMatchObject({
      utterance: "I'm feeling a bit dizzy",
    });
    expect(routeIntent('CallForHelpIntent', {})).toMatchObject({ kind: 'agent', speaker: 'elder' });
    expect(routeIntent('CaregiverSummaryIntent', {})).toEqual({
      kind: 'agent',
      utterance: 'how is Eleanor doing this week',
      speaker: 'caregiver',
    });
    expect(routeIntent('AnythingIntent', { query: 'when is my next appointment' })).toMatchObject({
      utterance: 'when is my next appointment',
    });
  });

  it('asks locally when a slot is missing and ignores intents it does not own', () => {
    expect(routeIntent('TookIntent', {})).toMatchObject({
      kind: 'say',
      speech: expect.stringContaining('Which medication'),
    });
    expect(routeIntent('OverrideIntent', {})).toMatchObject({ kind: 'say', speech: expect.stringContaining('why') });
    expect(routeIntent('FeelingIntent', {})).toMatchObject({ kind: 'say' });
    expect(routeIntent('AnythingIntent', {})).toMatchObject({ kind: 'say' });
    expect(routeIntent('AMAZON.HelpIntent', {})).toBeUndefined();
    expect(routeIntent('SomethingElseIntent', {})).toBeUndefined();
  });

  it('prefers the entity-resolution canonical value and falls back to the words heard', () => {
    const resolved = {
      name: 'medication',
      value: 'diabetes pill',
      confirmationStatus: 'NONE',
      resolutions: {
        resolutionsPerAuthority: [
          {
            authority: 'amzn1.er-authority.echo-sdk.x.MEDICATION_NAME',
            status: { code: 'ER_SUCCESS_MATCH' },
            values: [{ value: { name: 'metformin', id: 'metformin' } }],
          },
        ],
      },
    } as any;
    expect(slotText(resolved)).toBe('metformin');
    const unresolved = {
      name: 'medication',
      value: '  atorvastatin ',
      confirmationStatus: 'NONE',
      resolutions: {
        resolutionsPerAuthority: [{ authority: 'x', status: { code: 'ER_SUCCESS_NO_MATCH' }, values: [] }],
      },
    } as any;
    expect(slotText(unresolved)).toBe('atorvastatin');
    expect(slotText({ name: 'medication', confirmationStatus: 'NONE' } as any)).toBeUndefined();
    expect(slotText(undefined)).toBeUndefined();
  });

  it('turns markdown into something Alexa can say and a card can show', () => {
    const reply =
      '**Good morning, Eleanor.**\n\n- Lisinopril at 8 a.m. — taken\n- _Metformin_ at 6 p.m.\n\nSee [the plan](https://x.y).';
    expect(stripMarkdown(reply)).toBe(
      'Good morning, Eleanor.\n\nLisinopril at 8 a.m. — taken\nMetformin at 6 p.m.\n\nSee the plan.'
    );
    expect(toSpeech(reply)).toBe(
      'Good morning, Eleanor. Lisinopril at 8 a.m. — taken Metformin at 6 p.m. See the plan.'
    );
    expect(toSpeech('x'.repeat(9000)).length).toBeLessThan(8000);
    expect(toSpeech('call get_todays_plan first')).toBe('call get_todays_plan first');
  });
});

describe('POST /alexa — the classic Alexa Skill front end over the same agent loop', () => {
  let srv: TestServer;

  beforeAll(async () => {
    srv = await startSkillServer();
  });

  afterAll(async () => {
    await srv.close();
  });

  it('LaunchRequest: welcomes Eleanor as JSON and keeps the session open', async () => {
    const json = await skill(srv, launch());
    expect(json.version).toBe('1.0');
    expect(speech(json)).toBe(
      "Hi Eleanor. You can ask for your plan, tell me what you took, or say how you're feeling."
    );
    expect(json.response.shouldEndSession).toBe(false);
    expect(json.response.reprompt?.outputSpeech.text).toContain('ask for your plan');
    expect(json.response.card).toBeUndefined();
  });

  it('PlanIntent → "what\'s my plan today" → get_todays_plan through MCP, with a card and the reprompt', async () => {
    const before = srv.agent.status().turnsToday;
    const json = await skill(srv, intent('PlanIntent'));
    expect(speech(json)).toContain('Good morning, Eleanor.'); // 10:30 in Los Angeles, the mid-morning scenario
    expect(json.response.shouldEndSession).toBe(false);
    expect(json.response.reprompt?.outputSpeech).toEqual({ type: 'PlainText', text: 'Anything else?' });
    expect(json.response.card).toMatchObject({ type: 'Simple', title: 'CareCompanion' });
    expect(json.response.card?.content).toContain('Good morning, Eleanor.');
    expect(json.response.directives ?? []).toHaveLength(0); // no APL on a device without a screen
    expect(json.sessionAttributes?.history).toEqual([
      { role: 'user', text: "what's my plan today" },
      { role: 'assistant', text: expect.stringContaining('Good morning, Eleanor.') },
    ]);
    expect(srv.agent.status().turnsToday).toBe(before + 1);
    expect(srv.app.mcp.sessions.size).toBe(0); // the per-turn loopback MCP session was terminated
  });

  it('TookIntent + OverrideIntent: the duplicate-dose guard round trip survives on session attributes', async () => {
    const first = await skill(srv, intent('TookIntent', { medication: 'lisinopril' }));
    expect(speech(first)).toContain('You already took Lisinopril at 8:05 a.m. today.');
    expect(first.response.shouldEndSession).toBe(false);
    const attributes = first.sessionAttributes ?? {};
    expect(attributes.history).toHaveLength(2);

    // The next request carries the returned sessionAttributes back, exactly as Alexa does within a session.
    const second = await skill(
      srv,
      intent('OverrideIntent', { reason: 'the doctor told me to double it today' }, { attributes })
    );
    expect(speech(second)).toContain("I've recorded the extra Lisinopril");
    expect(second.sessionAttributes?.history).toHaveLength(4);
    expect(srv.store.get().alerts.some((a) => a.type === 'dose_override')).toBe(true);
  });

  it('OverrideIntent without a reason asks for one instead of inventing it', async () => {
    const before = srv.agent.status().turnsToday;
    const json = await skill(srv, intent('OverrideIntent'));
    expect(speech(json)).toContain('I need to know why');
    expect(srv.agent.status().turnsToday).toBe(before); // no agent turn, no tool call
  });

  it('FeelingIntent "a bit dizzy" runs the check-in and escalates to the priority-1 caregiver', async () => {
    const json = await skill(srv, intent('FeelingIntent', { feeling: 'a bit dizzy' }));
    expect(speech(json)).toContain("I've let Priya Whitfield-Singh know");
    expect(json.response.reprompt?.outputSpeech.text).toBe('Anything else?');
  });

  it('CallForHelpIntent speaks the emergency guidance first and asks no follow-up question', async () => {
    const json = await skill(srv, intent('CallForHelpIntent'));
    expect(speech(json).startsWith('This could be an emergency. Please call 911 right now.')).toBe(true);
    expect(json.response.reprompt).toBeUndefined();
    expect(json.response.shouldEndSession).toBe(false);
    expect(srv.store.get().alerts.some((a) => a.type === 'help')).toBe(true);
  });

  it('CaregiverSummaryIntent speaks as the caregiver and gets the weekly summary', async () => {
    const json = await skill(srv, intent('CaregiverSummaryIntent'));
    expect(speech(json)).toMatch(/7-day adherence is \d+ percent/);
  });

  it('AnythingIntent forwards the raw query', async () => {
    const json = await skill(srv, intent('AnythingIntent', { query: 'what is my plan today' }));
    expect(speech(json)).toContain('Good morning, Eleanor.');
  });

  it('renders the APL document only for devices that support APL', async () => {
    const json = await skill(srv, intent('PlanIntent', {}, { apl: true }));
    const directive = (json.response.directives ?? []).find((d) => d.type === 'Alexa.Presentation.APL.RenderDocument');
    expect(directive).toBeDefined();
    expect(directive?.token).toBe('carecompanion.reply');
    expect(directive?.document).toMatchObject({ type: 'APL', version: '2023.3', theme: 'dark' });
    expect(directive?.datasources.care.title).toBe('CareCompanion');
    expect(directive?.datasources.care.body).toContain('Good morning, Eleanor.');
    expect(directive?.datasources.care.footer).toBe('Not medical advice · demo data');

    const plain = await skill(srv, intent('PlanIntent'));
    expect(plain.response.directives ?? []).toHaveLength(0);
  });

  it('a missing medication slot is answered locally, without an agent turn', async () => {
    const before = srv.agent.status().turnsToday;
    const json = await skill(srv, intent('TookIntent'));
    expect(speech(json)).toContain('Which medication did you take?');
    expect(json.response.shouldEndSession).toBe(false);
    expect(srv.agent.status().turnsToday).toBe(before);
  });

  it('built-ins: help lists what to say, fallback never calls the agent, stop ends the session', async () => {
    const before = srv.agent.status().turnsToday;
    const help = await skill(srv, intent('AMAZON.HelpIntent'));
    expect(speech(help)).toContain("what's my plan today");
    expect(speech(help)).toContain('say: I need help');

    const fallback = await skill(srv, intent('AMAZON.FallbackIntent'));
    expect(speech(fallback)).toContain("I didn't catch that");
    expect(fallback.response.shouldEndSession).toBe(false);

    const stop = await skill(srv, intent('AMAZON.StopIntent'));
    expect(speech(stop)).toBe('Take care, Eleanor.');
    expect(stop.response.shouldEndSession).toBe(true);
    const cancel = await skill(srv, intent('AMAZON.CancelIntent'));
    expect(cancel.response.shouldEndSession).toBe(true);

    const ended = await skill(srv, envelope({ type: 'SessionEndedRequest', reason: 'USER_INITIATED' }));
    expect(ended.response.outputSpeech).toBeUndefined();

    const unknown = await skill(srv, intent('NotAnIntentWeKnow'));
    expect(speech(unknown)).toContain("I didn't catch that");
    expect(srv.agent.status().turnsToday).toBe(before);
  });

  it('a stale timestamp is accepted while verification is off (local tests only — never in production)', async () => {
    const json = await skill(srv, launch({ timestamp: '2020-01-01T00:00:00.000Z' }));
    expect(speech(json)).toContain('Hi Eleanor.');
  });

  it('never answers a malformed envelope with a stack trace', async () => {
    const res = await post(srv, { version: '1.0' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ version: '1.0', response: {} });
    expect(res.body).not.toMatch(/at .*\.js:\d+/); // no stack frames leak into the body
  });
});

describe('POST /alexa with request verification on (the production default)', () => {
  let srv: TestServer;

  beforeAll(async () => {
    srv = await startSkillServer(VERIFY_ON);
  });

  afterAll(async () => {
    await srv.close();
  });

  it('rejects a bogus signature with 400 from the adapter — proof the JSON parser left the raw body alone', async () => {
    const res = await post(srv, launch(), {
      signaturecertchainurl: 'https://example.com/not-amazon.pem',
      'signature-256': 'Ym9ndXM=',
    });
    expect(res.status).toBe(400);
    expect(res.body).toContain('Request verification failed');
    expect(res.body).not.toContain('Do not register any parsers'); // the adapter's 500 when a parser ran first
  });

  it('rejects an unsigned request', async () => {
    const unsigned = await post(srv, launch());
    expect(unsigned.status).toBe(400);
    expect(unsigned.body).toContain('Missing Certificate');
  });
});

describe('POST /alexa with only the timestamp check on', () => {
  let srv: TestServer;

  beforeAll(async () => {
    srv = await startSkillServer({ ALEXA_VERIFY_SIGNATURE: 'false', ALEXA_VERIFY_TIMESTAMP: 'true' });
  });

  afterAll(async () => {
    await srv.close();
  });

  it('rejects a replayed (stale) request and accepts a fresh one', async () => {
    const stale = await post(srv, launch({ timestamp: '2020-01-01T00:00:00.000Z' }));
    expect(stale.status).toBe(400);
    expect(stale.body).toContain('Timestamp verification failed');
    expect(speech(await skill(srv, launch()))).toContain('Hi Eleanor.');
  });
});

describe('ALEXA_SKILL / ALEXA_SKILL_ID', () => {
  it('ALEXA_SKILL=off leaves /alexa unmounted and /healthz says so', async () => {
    const srv = await startSkillServer({ ALEXA_SKILL: 'off' });
    try {
      expect((await post(srv, launch())).status).toBe(404);
      const health = (await (await fetch(`${srv.baseUrl}/healthz`)).json()) as { alexaSkill: boolean };
      expect(health.alexaSkill).toBe(false);
    } finally {
      await srv.close();
    }
  });

  it('ALEXA_SKILL_ID pins the endpoint to one skill', async () => {
    const srv = await startSkillServer({ ALEXA_SKILL_ID: APP_ID });
    try {
      const health = (await (await fetch(`${srv.baseUrl}/healthz`)).json()) as { alexaSkill: boolean };
      expect(health.alexaSkill).toBe(true);
      expect(speech(await skill(srv, launch()))).toContain('Hi Eleanor.');
      const other = await post(srv, launch({ applicationId: 'amzn1.ask.skill.someone-else' }));
      expect(other.status).not.toBe(200);
      expect(other.body).toContain('ID verification failed');
    } finally {
      await srv.close();
    }
  });
});

describe('the Alexa deadline', () => {
  it('answers "give me a moment" when the agent is slower than ALEXA_AGENT_TIMEOUT_MS, and drops the late reply', async () => {
    const srv = await startSkillServer({ ALEXA_AGENT_TIMEOUT_MS: '0' });
    try {
      const json = await skill(srv, intent('PlanIntent'));
      expect(speech(json)).toBe('Give me a moment and ask again.');
      expect(json.response.shouldEndSession).toBe(false);
      expect(json.sessionAttributes?.history).toBeUndefined(); // nothing was said, so nothing is remembered
      // The agent turn keeps running in the background; let it finish before the server goes away.
      await waitFor(() => srv.agent.status().turnsToday === 1, 10_000);
    } finally {
      await srv.close();
    }
  });
});
