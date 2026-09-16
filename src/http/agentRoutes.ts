import type { Express } from 'express';
import * as z from 'zod/v4';
import type { AgentService } from '../agent/service.js';
import { DomainError } from '../domain/actions.js';
import type { Logger } from '../log.js';
import { rateLimit } from './rateLimit.js';

const AgentRequestSchema = z.object({
  utterance: z.string().trim().min(1).max(1000),
  speaker: z.enum(['elder', 'caregiver']).optional(),
  elderId: z.string().optional(),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) }))
    .max(20)
    .optional(),
});

export function mountAgentRoutes(app: Express, agent: AgentService, log: Logger, perMinute: number): void {
  app.get('/api/agent/status', (_req, res) => {
    res.json(agent.status());
  });

  app.post('/api/agent', rateLimit(perMinute), (req, res) => {
    const parsed = AgentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues.map((i) => i.message) });
      return;
    }
    const started = performance.now();
    agent
      .respond(parsed.data)
      .then((response) => {
        log.info('agent turn', {
          brain: response.brain,
          tools: response.toolCalls.map((t) => t.name),
          ms: Math.round(performance.now() - started),
        });
        res.json(response);
      })
      .catch((err: unknown) => {
        if (err instanceof DomainError) {
          res.status(404).json({ error: err.code, message: err.message });
          return;
        }
        log.error('agent turn failed', { err });
        res.status(502).json({ error: 'agent_failed', message: 'The assistant could not complete that turn.' });
      });
  });
}
