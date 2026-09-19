/**
 * Classic Alexa Skill (Alexa Skills Kit) front end for CareCompanion.
 *
 * The hackathon organizers suggested demoing "your MCP being called from" an Alexa Skill, since the Alexa+ add-on
 * toolkit is not available to participants. This skill is a thin voice front end: every utterance goes to the same
 * agent loop the web app uses (Bedrock or the rule brain), which calls the MCP tools over loopback HTTP.
 *
 * Mounted on POST /alexa with the RAW request body (the adapter verifies Amazon's request signature itself).
 * Setup for the skill owner: docs/alexa-skill.md. Interaction model and manifest: skill-package/.
 */
import type { RequestHandler } from 'express';
import { SkillBuilders } from 'ask-sdk-core';
import { ExpressAdapter } from 'ask-sdk-express-adapter';
import type { AgentService } from '../agent/service.js';
import type { Config } from '../config.js';
import type { Logger } from '../log.js';
import { APP_VERSION } from '../version.js';
import { loadAlexaConfig } from './config.js';
import { buildHandlers } from './handlers.js';

export interface AlexaDeps {
  agent: AgentService;
  config: Config;
  log: Logger;
}

/** Returns the Express handlers for the skill endpoint, or [] when the skill is disabled (`ALEXA_SKILL=off`). */
export function createAlexaHandlers(deps: AlexaDeps): RequestHandler[] {
  const log = deps.log.child('alexa');
  const alexa = loadAlexaConfig();
  if (!alexa.enabled) {
    log.info('Alexa Skill disabled (ALEXA_SKILL=off)');
    return [];
  }

  const handlers = buildHandlers({ agent: deps.agent, config: alexa, log });
  const builder = SkillBuilders.custom()
    .addRequestHandlers(...handlers.requestHandlers)
    .addErrorHandlers(...handlers.errorHandlers)
    .addRequestInterceptors(...handlers.requestInterceptors)
    .addResponseInterceptors(...handlers.responseInterceptors)
    .withCustomUserAgent(`carecompanion/${APP_VERSION}`);
  if (alexa.skillId) builder.withSkillId(alexa.skillId);

  // The adapter returns [guard against pre-parsed bodies, text body parser, verify + dispatch]. It needs the raw
  // body: src/http/app.ts skips the JSON parser for /alexa so the signature can be checked over the exact bytes.
  const adapter = new ExpressAdapter(builder.create(), alexa.verifySignature, alexa.verifyTimestamp);

  if (!alexa.verifySignature || !alexa.verifyTimestamp) {
    log.warn('Alexa request verification is partly OFF — local testing only, never in production', {
      verifySignature: alexa.verifySignature,
      verifyTimestamp: alexa.verifyTimestamp,
    });
  }
  log.info('Alexa Skill ready', {
    endpoint: `${deps.config.publicUrl}/alexa`,
    skillId: alexa.skillId ?? '(not pinned — set ALEXA_SKILL_ID)',
    verifySignature: alexa.verifySignature,
    verifyTimestamp: alexa.verifyTimestamp,
    agentTimeoutMs: alexa.agentTimeoutMs,
  });
  return adapter.getRequestHandlers();
}
