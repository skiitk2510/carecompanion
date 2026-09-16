import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import type { CareActions } from '../../domain/actions.js';
import type { Logger } from '../../log.js';
import { run } from '../result.js';
import { CaregiverSummaryInput, CaregiverSummaryOutput } from '../schemas.js';

export const DASHBOARD_URI = 'ui://carecompanion/dashboard.html';

/**
 * `caregiver_summary` is the MCP App tool: hosts that support MCP Apps (Alexa+, Inspector, basic-host) render the
 * dashboard view inline from the `ui://` resource; text-only hosts get the spoken summary. Both are always returned.
 */
export function registerDashboard(server: McpServer, actions: CareActions, log: Logger, html: () => string): void {
  registerAppTool(
    server,
    'caregiver_summary',
    {
      title: 'Caregiver summary and dashboard',
      description:
        "Caregiver-facing summary of the elder's week: medication adherence (7 or 30 days), today's doses, open alerts, the check-in trend and upcoming appointments. Hosts that support MCP Apps also render the live family dashboard.",
      inputSchema: CaregiverSummaryInput,
      outputSchema: CaregiverSummaryOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: DASHBOARD_URI, visibility: ['model', 'app'] } },
    },
    async ({ elderId, days }) => run(log, 'caregiver_summary', () => actions.caregiverSummary(elderId, days ?? 7))
  );

  registerAppResource(
    server,
    'CareCompanion dashboard',
    DASHBOARD_URI,
    {
      description: 'Family caregiver dashboard (MCP App view for caregiver_summary).',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: DASHBOARD_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: html(),
          // The view makes no network calls of its own — everything arrives through the host's tool bridge.
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
        },
      ],
    })
  );
}
