import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import type { CareActions } from '../../domain/actions.js';
import type { Logger } from '../../log.js';
import { run } from '../result.js';
import { DASHBOARD_URI } from './dashboard.js';

/** Elder-facing tools that also render a screen on MCP App hosts (Echo Show-class devices): same view bundle. */
const ELDER_VIEW = { ui: { resourceUri: DASHBOARD_URI, visibility: ['model', 'app'] as ['model', 'app'] } };
import {
  CallForHelpInput,
  CallForHelpOutput,
  DailyCheckinInput,
  DailyCheckinOutput,
  GetTodaysPlanInput,
  GetTodaysPlanOutput,
  LogDoseInput,
  LogDoseOutput,
  SkipDoseInput,
  SkipDoseOutput,
} from '../schemas.js';

/** The five tools an elder drives by voice. Every result's text is written to be spoken aloud. */
export function registerElderTools(server: McpServer, actions: CareActions, log: Logger): void {
  registerAppTool(
    server,
    'get_todays_plan',
    {
      title: "Today's plan",
      description:
        "The elder's medication schedule for today — what's taken, what's next, any missed dose, upcoming appointments, and whether they've checked in. Call this first for any \"what's my day\" or \"what do I take\" question.",
      inputSchema: GetTodaysPlanInput,
      outputSchema: GetTodaysPlanOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      _meta: ELDER_VIEW,
    },
    async ({ elderId }) => run(log, 'get_todays_plan', () => actions.todaysPlan(elderId))
  );

  registerAppTool(
    server,
    'log_dose',
    {
      title: 'Log a dose',
      description:
        'Record that the elder took a medication (name as spoken — brand names and "my blood pressure pill" work). ' +
        'A safety guard may REFUSE a duplicate or too-soon dose: when `requiresConfirmation` is true, do NOT retry silently — ' +
        'tell the elder what the guard said, ask them to confirm and say why, and only then call again with confirmOverride=true and overrideReason. ' +
        'If the name is ambiguous the result lists `candidates`; ask which one.',
      inputSchema: LogDoseInput,
      outputSchema: LogDoseOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: ELDER_VIEW,
    },
    async (args) => run(log, 'log_dose', () => actions.logDose(args))
  );

  server.registerTool(
    'skip_dose',
    {
      title: 'Skip a dose',
      description:
        'Record that the elder is deliberately skipping the next due dose of a medication, with an optional reason. Skipping a critical medication alerts the caregiver.',
      inputSchema: SkipDoseInput,
      outputSchema: SkipDoseOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => run(log, 'skip_dose', () => actions.skipDose(args))
  );

  server.registerTool(
    'daily_checkin',
    {
      title: 'Daily check-in',
      description:
        'Record how the elder feels today: their mood plus any symptoms in their own words. Runs symptom escalation and alerts caregivers automatically for urgent or emergency symptoms. ' +
        'If the result contains `emergencyGuidance`, say it to the elder FIRST and verbatim.',
      inputSchema: DailyCheckinInput,
      outputSchema: DailyCheckinOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => run(log, 'daily_checkin', () => actions.dailyCheckIn(args))
  );

  server.registerTool(
    'call_for_help',
    {
      title: 'Call for help',
      description:
        'The elder asked for help or said something alarming outside a check-in ("help", "I fell", "I can\'t breathe"). Immediately alerts ALL caregivers and returns emergency guidance to speak verbatim.',
      inputSchema: CallForHelpInput,
      outputSchema: CallForHelpOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => run(log, 'call_for_help', () => actions.callForHelp(args))
  );
}
