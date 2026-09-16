import type { Response } from 'express';
import { DomainError } from '../domain/actions.js';
import type { Logger } from '../log.js';

/** Runs a synchronous action for a REST route; domain errors map to 4xx JSON, anything else to 500. */
export function respond(res: Response, log: Logger, fn: () => unknown): void {
  try {
    res.json(fn());
  } catch (err) {
    if (err instanceof DomainError) {
      res.status(err.code === 'invalid_input' ? 400 : 404).json({ error: err.code, message: err.message });
      return;
    }
    log.error('request failed', { err });
    res.status(500).json({ error: 'internal', message: 'Something went wrong on the CareCompanion server.' });
  }
}
