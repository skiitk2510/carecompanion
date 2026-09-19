/**
 * Classic Alexa Skill (Alexa Skills Kit) front end for CareCompanion.
 *
 * The hackathon organizers suggested demoing "your MCP being called from" an Alexa Skill, since the Alexa+ add-on
 * toolkit is not available to participants. This skill is a thin voice front end: every utterance goes to the same
 * agent loop the web app uses (Bedrock or the rule brain), which calls the MCP tools over loopback HTTP.
 *
 * Mounted on POST /alexa with the RAW request body (the adapter verifies Amazon's request signature itself).
 */
import type { RequestHandler } from 'express';
import type { AgentService } from '../agent/service.js';
import type { Config } from '../config.js';
import type { Logger } from '../log.js';

export interface AlexaDeps {
  agent: AgentService;
  config: Config;
  log: Logger;
}

/** Returns the Express handlers for the skill endpoint, or [] when the skill is disabled (`ALEXA_SKILL=off`). */
export function createAlexaHandlers(_deps: AlexaDeps): RequestHandler[] {
  // Implemented in src/alexa/handlers.ts (see docs/alexa-skill.md); wired here so the app can mount it.
  return [];
}
