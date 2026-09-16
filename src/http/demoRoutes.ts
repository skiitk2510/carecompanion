import type { Express } from 'express';
import * as z from 'zod/v4';
import type { Config } from '../config.js';
import type { CareActions } from '../domain/actions.js';
import type { Logger } from '../log.js';
import { respond } from './respond.js';

const ResetBody = z.object({
  scenario: z.enum(['default', 'mid-morning', 'evening']).optional(),
  /** Shift "now" by a fixed number of minutes … */
  clockOffsetMin: z.number().int().min(-1440).max(1440).optional(),
  /** … or to a wall-clock time in the household timezone (e.g. "10:30" for the mid-morning beats). */
  targetLocalTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
});

/** Demo controls: status is public; reset needs the `x-demo-token` header (`DEMO_RESET_TOKEN`). */
export function mountDemoRoutes(app: Express, actions: CareActions, config: Config, log: Logger): void {
  app.get('/api/demo/status', (_req, res) => {
    respond(res, log, () => actions.demoStatus());
  });

  app.post('/api/demo/reset', (req, res) => {
    if (!config.demoResetToken || req.header('x-demo-token') !== config.demoResetToken) {
      res.status(401).json({ error: 'unauthorized', message: 'Set the x-demo-token header.' });
      return;
    }
    const parsed = ResetBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues.map((i) => i.message) });
      return;
    }
    log.info('demo reset requested', parsed.data);
    respond(res, log, () => actions.resetDemo(parsed.data));
  });
}
