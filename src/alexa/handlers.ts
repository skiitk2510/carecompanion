/**
 * ask-sdk-core handlers for the CareCompanion skill.
 *
 * The interaction model (skill-package/interactionModels/custom/en-US.json) turns speech into an intent plus slot
 * values; each handler here turns that back into ONE natural sentence (`routeIntent`) and hands it to the same agent
 * loop the web app uses — Bedrock or the rule brain, calling the MCP tools over loopback HTTP. No domain logic lives
 * in this file: the guardrails answer through the agent's reply exactly as they do for `POST /api/agent`.
 *
 * Conversation memory is the Alexa session: the last few turns ride along in `sessionAttributes`, which is how
 * "yes, record it anyway because …" still knows which medication the guard refused a moment ago.
 */
import type { ErrorHandler, HandlerInput, RequestHandler, RequestInterceptor, ResponseInterceptor } from 'ask-sdk-core';
import type { IntentRequest, Response, SessionEndedRequest, Slot } from 'ask-sdk-model';
import type { AgentService } from '../agent/service.js';
import type { Logger } from '../log.js';
import type { AgentTurn, Speaker } from '../shared/agent.js';
import { renderReplyDirective } from './apl.js';
import type { AlexaConfig } from './config.js';

export const CARD_TITLE = 'CareCompanion';
/** The seeded demo household's elder. The agent itself reads the real name and context from the store. */
export const PREFERRED_NAME = 'Eleanor';
/** Alexa caps outputSpeech and card content at 8000 characters; stay clearly under it. */
export const MAX_SPEECH_CHARS = 7_900;

export const INTENT = {
  plan: 'PlanIntent',
  took: 'TookIntent',
  override: 'OverrideIntent',
  skip: 'SkipIntent',
  feeling: 'FeelingIntent',
  help: 'CallForHelpIntent',
  summary: 'CaregiverSummaryIntent',
  anything: 'AnythingIntent',
} as const;

export const SPEECH = {
  welcome: `Hi ${PREFERRED_NAME}. You can ask for your plan, tell me what you took, or say how you're feeling.`,
  welcomeReprompt: "You can ask for your plan, tell me what you took, or say how you're feeling.",
  reprompt: 'Anything else?',
  help:
    "You can say: what's my plan today. Or: I took my lisinopril. Or: I'm feeling a bit dizzy. " +
    'If something is wrong right now, say: I need help.',
  fallback: "I didn't catch that. You can ask for your plan, tell me what you took, or say how you're feeling.",
  goodbye: `Take care, ${PREFERRED_NAME}.`,
  slow: 'Give me a moment and ask again.',
  error: 'Sorry, something went wrong on my end. Please try again in a moment.',
  whichTook: 'Which medication did you take? For example, say: I took my lisinopril.',
  whichSkip: 'Which medication do you want to skip? For example, say: skip my metformin.',
  whyOverride:
    'Before I record an extra dose I need to know why. Say: yes, record it anyway because, and then give your reason.',
  howFeeling: 'How are you feeling today? For example, say: I feel fine, or: I feel a bit dizzy.',
  emptyQuery: "Tell me what you'd like to say.",
  done: 'Okay.',
} as const;

// --- intent → utterance ------------------------------------------------------------------------------------------

export type SlotValues = Record<string, string | undefined>;

export type Route = { kind: 'agent'; utterance: string; speaker: Speaker } | { kind: 'say'; speech: string };

/**
 * Rebuilds the sentence the agent should hear from the intent and its slots. Fixed phrasings are chosen so the
 * offline rule brain routes them exactly like the web demo's lines; the Bedrock brain reads them as plain English.
 * A missing slot is answered with a short question here, without a round trip to the agent. Returns undefined for
 * intents that are not CareCompanion's (the built-in ones have their own handlers).
 */
export function routeIntent(name: string, slots: SlotValues): Route | undefined {
  const agent = (utterance: string, speaker: Speaker = 'elder'): Route => ({ kind: 'agent', utterance, speaker });
  const say = (speech: string): Route => ({ kind: 'say', speech });
  switch (name) {
    case INTENT.plan:
      return agent("what's my plan today");
    case INTENT.took:
      return slots.medication ? agent(`I took my ${slots.medication}`) : say(SPEECH.whichTook);
    case INTENT.skip:
      return slots.medication ? agent(`skip my ${slots.medication}`) : say(SPEECH.whichSkip);
    case INTENT.override:
      // The guard needs an explicit confirmation AND a reason; without a reason we ask rather than invent one.
      return slots.reason
        ? agent(`yes, record it anyway because ${slots.reason.replace(/^(?:because|since|as)\s+/i, '')}`)
        : say(SPEECH.whyOverride);
    case INTENT.feeling:
      return slots.feeling ? agent(`I'm feeling ${slots.feeling}`) : say(SPEECH.howFeeling);
    case INTENT.help:
      // The interaction model has no slot for the words themselves; the agent alerts everyone either way.
      return agent('Help. I need help right now.');
    case INTENT.summary:
      return agent(`how is ${PREFERRED_NAME} doing this week`, 'caregiver');
    case INTENT.anything:
      return slots.query ? agent(slots.query) : say(SPEECH.emptyQuery);
    default:
      return undefined;
  }
}

/** The slot's text: the canonical value when entity resolution matched a slot-type entry, otherwise what was heard. */
export function slotText(slot: Slot | undefined): string | undefined {
  if (!slot) return undefined;
  for (const authority of slot.resolutions?.resolutionsPerAuthority ?? []) {
    if (authority.status?.code !== 'ER_SUCCESS_MATCH') continue;
    const name = authority.values?.[0]?.value?.name;
    if (name) return cleanSlot(name);
  }
  return cleanSlot(slot.value);
}

function cleanSlot(value: string | undefined): string | undefined {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  return v.length > 0 ? v.slice(0, 200) : undefined;
}

function slotValues(request: IntentRequest): SlotValues {
  const out: SlotValues = {};
  for (const [name, slot] of Object.entries(request.intent.slots ?? {})) out[name] = slotText(slot);
  return out;
}

// --- speech shaping ------------------------------------------------------------------------------------------------

/** Markdown → plain text for a card or screen: no emphasis marks, headings, bullets, code or link syntax. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*(?:[-*+•]|\d+[.)])[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[\s(])[*_](?=\S)([^*_\n]*?\S)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** What Alexa says: markdown stripped, whitespace collapsed, kept under the outputSpeech limit. */
export function toSpeech(text: string): string {
  return clamp(stripMarkdown(text).replace(/\s+/g, ' ').trim());
}

function clamp(text: string, max = MAX_SPEECH_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(' ', max - 1);
  return `${text.slice(0, cut > max / 2 ? cut : max - 1).trimEnd()}…`;
}

// --- session history -------------------------------------------------------------------------------------------------

const HISTORY_KEY = 'history';
/** Entries kept in the session — the same window AgentService uses. */
const MAX_HISTORY_TURNS = 6;
/** Session attributes ride along on every request, so each stored turn is kept short. */
const MAX_TURN_CHARS = 600;

function isTurn(value: unknown): value is AgentTurn {
  if (typeof value !== 'object' || value === null) return false;
  const turn = value as Record<string, unknown>;
  return (turn.role === 'user' || turn.role === 'assistant') && typeof turn.text === 'string';
}

export function readHistory(input: HandlerInput): AgentTurn[] {
  if (!input.requestEnvelope.session) return [];
  const raw: unknown = input.attributesManager.getSessionAttributes()[HISTORY_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isTurn).slice(-MAX_HISTORY_TURNS);
}

export function writeHistory(input: HandlerInput, history: AgentTurn[]): void {
  if (!input.requestEnvelope.session) return;
  const attributes = input.attributesManager.getSessionAttributes();
  attributes[HISTORY_KEY] = history
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, text: turn.text.slice(0, MAX_TURN_CHARS) }));
  input.attributesManager.setSessionAttributes(attributes);
}

// --- responses ---------------------------------------------------------------------------------------------------------

interface Spoken {
  speech: string;
  /** Text for the card and the screen (may keep line breaks); defaults to the speech. */
  display?: string;
  /** Omitted after emergency guidance: the session stays open, but Alexa must not follow up with a question. */
  reprompt?: string;
  endSession?: boolean;
  card?: boolean;
}

function supportsApl(input: HandlerInput): boolean {
  return input.requestEnvelope.context?.System?.device?.supportedInterfaces?.['Alexa.Presentation.APL'] !== undefined;
}

/** PlainText output (no SSML escaping to get wrong), an optional card, and the APL card on screen devices. */
function spokenResponse(input: HandlerInput, spoken: Spoken): Response {
  const display = spoken.display ?? spoken.speech;
  const builder = input.responseBuilder;
  if (spoken.card) builder.withSimpleCard(CARD_TITLE, clamp(display));
  if (supportsApl(input)) builder.addDirective(renderReplyDirective({ body: display }));
  builder.withShouldEndSession(spoken.endSession ?? false);
  const response = builder.getResponse();
  response.outputSpeech = { type: 'PlainText', text: spoken.speech };
  if (spoken.reprompt !== undefined) {
    response.reprompt = { outputSpeech: { type: 'PlainText', text: spoken.reprompt } };
  }
  return response;
}

type Outcome<T> = { timedOut: false; value: T } | { timedOut: true; settled: Promise<T> };

/** Resolves with the work's value, or with `timedOut` after `ms` while the work carries on in the background. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<Outcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<Outcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true, settled: work }), ms);
  });
  try {
    return await Promise.race([work.then((value) => ({ timedOut: false as const, value })), expiry]);
  } finally {
    clearTimeout(timer);
  }
}

// --- handlers ----------------------------------------------------------------------------------------------------------

export interface HandlerDeps {
  agent: AgentService;
  config: AlexaConfig;
  log: Logger;
}

export interface SkillHandlers {
  requestHandlers: RequestHandler[];
  errorHandlers: ErrorHandler[];
  requestInterceptors: RequestInterceptor[];
  responseInterceptors: ResponseInterceptor[];
}

interface AgentTrace {
  brain?: string;
  tools: string[];
  ms: number;
  timedOut: boolean;
  emergency: boolean;
}

// Tolerant of malformed envelopes (the SDK's getRequestType/getIntentName throw on them, even inside the error handler).
function requestType(input: HandlerInput): string {
  return input.requestEnvelope?.request?.type ?? 'unknown';
}

function intentName(input: HandlerInput): string | undefined {
  const request = input.requestEnvelope?.request;
  return request?.type === 'IntentRequest' ? (request as IntentRequest).intent?.name : undefined;
}

function isIntent(input: HandlerInput, ...names: string[]): boolean {
  const name = intentName(input);
  return name !== undefined && names.includes(name);
}

export function buildHandlers(deps: HandlerDeps): SkillHandlers {
  const { agent, config, log } = deps;

  async function respondViaAgent(input: HandlerInput, utterance: string, speaker: Speaker): Promise<Response> {
    const history = readHistory(input);
    const started = performance.now();
    const outcome = await withTimeout(agent.respond({ utterance, speaker, history }), config.agentTimeoutMs);
    const elapsed = Math.round(performance.now() - started);
    const requestAttributes = input.attributesManager.getRequestAttributes();

    if (outcome.timedOut) {
      requestAttributes.agent = { tools: [], ms: elapsed, timedOut: true, emergency: false } satisfies AgentTrace;
      outcome.settled.then(
        (late) =>
          log.warn('agent answered after the Alexa deadline; reply dropped', {
            tools: late.toolCalls.map((t) => t.name),
            ms: Math.round(performance.now() - started),
          }),
        (err: unknown) => log.warn('agent failed after the Alexa deadline', { err })
      );
      return spokenResponse(input, { speech: SPEECH.slow, reprompt: SPEECH.reprompt });
    }

    const response = outcome.value;
    const reply = toSpeech(response.reply) || SPEECH.done; // Alexa rejects empty output speech
    const guidance = response.emergencyGuidance ? toSpeech(response.emergencyGuidance) : undefined;
    // Emergency guidance is spoken first and verbatim (the tools already lead with it; a paraphrasing brain may not).
    const speech = guidance && !reply.startsWith(guidance) ? clamp(`${guidance} ${reply}`) : reply;
    const display =
      guidance && !reply.startsWith(guidance)
        ? `${guidance}\n\n${stripMarkdown(response.reply)}`
        : stripMarkdown(response.reply);

    writeHistory(input, [...history, { role: 'user', text: utterance }, { role: 'assistant', text: reply }]);
    requestAttributes.agent = {
      brain: response.brain,
      tools: response.toolCalls.map((t) => t.name),
      ms: elapsed,
      timedOut: false,
      emergency: guidance !== undefined,
    } satisfies AgentTrace;

    return spokenResponse(input, {
      speech,
      display,
      card: true,
      ...(guidance ? {} : { reprompt: SPEECH.reprompt }),
    });
  }

  const launch: RequestHandler = {
    canHandle: (input) => requestType(input) === 'LaunchRequest',
    handle: (input) => spokenResponse(input, { speech: SPEECH.welcome, reprompt: SPEECH.welcomeReprompt }),
  };

  const care: RequestHandler = {
    canHandle: (input) => {
      const name = intentName(input);
      return name !== undefined && routeIntent(name, {}) !== undefined;
    },
    handle: (input) => {
      const request = input.requestEnvelope.request as IntentRequest;
      const route = routeIntent(request.intent.name, slotValues(request));
      if (!route) throw new Error(`no route for intent ${request.intent.name}`);
      if (route.kind === 'say') return spokenResponse(input, { speech: route.speech, reprompt: SPEECH.reprompt });
      return respondViaAgent(input, route.utterance, route.speaker);
    },
  };

  const help: RequestHandler = {
    canHandle: (input) => isIntent(input, 'AMAZON.HelpIntent'),
    handle: (input) => spokenResponse(input, { speech: SPEECH.help, reprompt: SPEECH.welcomeReprompt }),
  };

  const fallback: RequestHandler = {
    canHandle: (input) => isIntent(input, 'AMAZON.FallbackIntent'),
    handle: (input) => spokenResponse(input, { speech: SPEECH.fallback, reprompt: SPEECH.welcomeReprompt }),
  };

  const stop: RequestHandler = {
    canHandle: (input) => isIntent(input, 'AMAZON.StopIntent', 'AMAZON.CancelIntent', 'AMAZON.NavigateHomeIntent'),
    handle: (input) => spokenResponse(input, { speech: SPEECH.goodbye, endSession: true }),
  };

  const sessionEnded: RequestHandler = {
    canHandle: (input) => requestType(input) === 'SessionEndedRequest',
    handle: (input) => {
      const request = input.requestEnvelope.request as SessionEndedRequest;
      log.info('alexa session ended', { reason: request.reason, error: request.error?.type });
      return input.responseBuilder.getResponse();
    },
  };

  // Anything else (an intent this build does not know, an APL user event, System.ExceptionEncountered): never 500.
  const unknown: RequestHandler = {
    canHandle: () => true,
    handle: (input) => {
      const type = requestType(input);
      log.warn('unhandled Alexa request', { type, intent: intentName(input) });
      if (type === 'IntentRequest') {
        return spokenResponse(input, { speech: SPEECH.fallback, reprompt: SPEECH.welcomeReprompt });
      }
      return input.responseBuilder.getResponse();
    },
  };

  // A calm apology, never a stack trace. Response interceptors do not run on this path, so it logs itself.
  const apology: ErrorHandler = {
    canHandle: () => true,
    handle: (input, error) => {
      const startedAt = Number(input.attributesManager.getRequestAttributes().startedAt ?? performance.now());
      log.error('alexa request failed', {
        type: requestType(input),
        intent: intentName(input),
        ms: Math.round(performance.now() - startedAt),
        err: error,
      });
      return spokenResponse(input, { speech: SPEECH.error, reprompt: SPEECH.reprompt });
    },
  };

  const timing: RequestInterceptor = {
    process: (input) => {
      input.attributesManager.setRequestAttributes({ startedAt: performance.now() });
    },
  };

  // One log line per request: what Alexa asked, how long it took, and which MCP tools the agent called.
  const logging: ResponseInterceptor = {
    process: (input, response) => {
      const attributes = input.attributesManager.getRequestAttributes();
      const trace = attributes.agent as AgentTrace | undefined;
      const startedAt = Number(attributes.startedAt ?? performance.now());
      log.info('alexa request', {
        type: requestType(input),
        intent: intentName(input),
        ms: Math.round(performance.now() - startedAt),
        tools: trace?.tools ?? [],
        ...(trace?.brain ? { brain: trace.brain } : {}),
        ...(trace?.timedOut ? { timedOut: true } : {}),
        ...(trace?.emergency ? { emergency: true } : {}),
        endSession: response?.shouldEndSession === true,
      });
    },
  };

  return {
    requestHandlers: [launch, care, help, fallback, stop, sessionEnded, unknown],
    errorHandlers: [apology],
    requestInterceptors: [timing],
    responseInterceptors: [logging],
  };
}
