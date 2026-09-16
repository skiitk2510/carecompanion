import type { McpServer } from '@modelcontextprotocol/server';
import type { CareActions } from '../../domain/actions.js';
import type { Logger } from '../../log.js';
import { run } from '../result.js';
import { AddMedicationInput, AddMedicationOutput, ResolveAlertInput, ResolveAlertOutput } from '../schemas.js';

/** Caregiver-side tools (the dashboard tool lives in dashboard.ts because it carries the MCP App view). */
export function registerCaregiverTools(server: McpServer, actions: CareActions, log: Logger): void {
  server.registerTool(
    'add_medication',
    {
      title: 'Add a medication',
      description:
        "Caregiver adds a medication to the elder's schedule. The medication is always added; the result also carries informational interaction and allergy warnings against the elder's current medications — read every warning and the disclaimer to the caregiver. Not medical advice.",
      inputSchema: AddMedicationInput,
      outputSchema: AddMedicationOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => run(log, 'add_medication', () => actions.addMedication(args))
  );

  server.registerTool(
    'resolve_alert',
    {
      title: 'Acknowledge or resolve an alert',
      description:
        'Caregiver acknowledges (seen, working on it) or resolves (done) an alert, with an optional resolution note for the audit trail. Safe to repeat.',
      inputSchema: ResolveAlertInput,
      outputSchema: ResolveAlertOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => run(log, 'resolve_alert', () => actions.resolveAlert(args))
  );
}
