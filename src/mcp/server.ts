import { McpServer } from '@modelcontextprotocol/server';
import type { CareActions } from '../domain/actions.js';
import type { Logger } from '../log.js';
import { APP_VERSION } from '../version.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { registerCaregiverTools } from './tools/caregiver.js';
import { registerDashboard } from './tools/dashboard.js';
import { registerElderTools } from './tools/elder.js';
import { uiHtml } from './uiHtml.js';

export interface ServerDeps {
  log: Logger;
  actions: CareActions;
  /** Override for tests; defaults to the built single-file view (or a placeholder). */
  uiHtml?: () => string;
}

export const SERVER_NAME = 'carecompanion';

export const SERVER_INSTRUCTIONS = [
  'CareCompanion coordinates medication reminders, daily check-ins and caregiver alerts for one elder household.',
  "Every tool's text is written to be spoken aloud — read it as-is.",
  'Contracts: (1) log_dose may refuse with requiresConfirmation=true; never retry silently — tell the elder what the guard said, ask them to confirm and give a reason, then call again with confirmOverride=true and overrideReason.',
  '(2) When a result contains emergencyGuidance, say it first and verbatim.',
  '(3) Elders use get_todays_plan, log_dose, skip_dose, daily_checkin and call_for_help; caregivers use add_medication, caregiver_summary and resolve_alert.',
  '(4) CareCompanion is a coordination and reminder tool, not medical advice; interaction warnings are informational.',
].join(' ');

/**
 * Builds a fresh McpServer. Cheap and side-effect free: the HTTP transport creates one per session, the stdio
 * binary exactly one. Shared state (the store) lives behind `deps.actions`, never in here.
 */
export function buildServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: APP_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  registerElderTools(server, deps.actions, deps.log);
  registerCaregiverTools(server, deps.actions, deps.log);
  registerDashboard(server, deps.actions, deps.log, deps.uiHtml ?? uiHtml);
  registerResources(server, deps.actions);
  registerPrompts(server);
  return server;
}
