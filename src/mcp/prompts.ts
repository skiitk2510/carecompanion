import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

/** A host-side template: the HOST's model fills it by calling our tools. No LLM runs on this server. */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'morning_briefing',
    {
      title: 'Morning briefing',
      description:
        "Speak a warm three-sentence morning briefing of the elder's day and ask one gentle check-in question.",
      argsSchema: z.object({
        elderId: z.string().optional().describe('Elder id. Omit for the household elder.'),
      }),
    },
    ({ elderId }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `Call the get_todays_plan tool${elderId ? ` with elderId "${elderId}"` : ''}. ` +
              "Then speak a warm morning briefing of at most three short sentences: what's next, anything missed, and today's or tomorrow's appointment. " +
              'Finish by asking one gentle check-in question, such as "How are you feeling this morning?". ' +
              'Use plain spoken language. Never give medical advice.',
          },
        },
      ],
    })
  );
}
