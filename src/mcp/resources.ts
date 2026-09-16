import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/server';
import type { CareActions } from '../domain/actions.js';

export const ADHERENCE_TEMPLATE = 'carecompanion://elder/{elderId}/adherence';

export function adherenceUri(elderId: string): string {
  return ADHERENCE_TEMPLATE.replace('{elderId}', elderId);
}

export function registerResources(server: McpServer, actions: CareActions): void {
  server.registerResource(
    'adherence',
    new ResourceTemplate(ADHERENCE_TEMPLATE, {
      list: async () => ({
        resources: actions.listElders().map((e) => ({
          uri: adherenceUri(e.id),
          name: `${e.name} — adherence report`,
          mimeType: 'application/json',
        })),
      }),
    }),
    {
      title: 'Adherence report',
      description:
        '7- and 30-day medication adherence for an elder (due / taken / late / missed / skipped, per day and per medication) as JSON.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const raw = variables.elderId;
      const elderId = Array.isArray(raw) ? raw[0] : raw;
      const report = actions.adherenceReport(elderId);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(report, null, 2) }] };
    }
  );
}
