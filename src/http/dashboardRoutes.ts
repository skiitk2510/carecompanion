/**
 * REST wrappers for the web app's caregiver pane. They call the same actions as the MCP tools; the MCP App view
 * does NOT use these (it talks to the server through the host's tool bridge).
 */
import type { Express } from 'express';
import * as z from 'zod/v4';
import type { CareActions } from '../domain/actions.js';
import type { Logger } from '../log.js';
import { AddMedicationInput } from '../mcp/schemas.js';
import { respond } from './respond.js';

const ResolveBody = z.object({
  caregiverId: z.string().min(1),
  action: z.enum(['acknowledge', 'resolve']),
  resolution: z.string().max(500).optional(),
});

const DoseBody = z.object({
  elderId: z.string().optional(),
  medication: z.string().min(1),
  confirmOverride: z.boolean().optional(),
  overrideReason: z.string().optional(),
});

export function mountDashboardRoutes(app: Express, actions: CareActions, log: Logger): void {
  app.get('/api/dashboard', (req, res) => {
    const days = req.query.days === '30' ? 30 : 7;
    const elderId = typeof req.query.elderId === 'string' ? req.query.elderId : undefined;
    respond(res, log, () => actions.caregiverSummary(elderId, days));
  });

  app.post('/api/dashboard/alerts/:id', (req, res) => {
    const parsed = ResolveBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues.map((i) => i.message) });
      return;
    }
    respond(res, log, () => actions.resolveAlert({ alertId: String(req.params.id), ...parsed.data }));
  });

  app.post('/api/dashboard/doses', (req, res) => {
    const parsed = DoseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues.map((i) => i.message) });
      return;
    }
    respond(res, log, () => actions.logDose({ ...parsed.data, source: 'caregiver' }));
  });

  app.post('/api/dashboard/medications', (req, res) => {
    const parsed = AddMedicationInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', issues: parsed.error.issues.map((i) => i.message) });
      return;
    }
    respond(res, log, () => actions.addMedication(parsed.data));
  });
}
