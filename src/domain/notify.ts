import type { Logger } from '../log.js';
import type { Alert, Caregiver } from './model.js';

/**
 * Caregiver notification is SIMULATED in this demo: the alert records who would have been notified and a log
 * line shows the channel. A production deployment would plug SMS/email/push providers in here.
 */
export function simulateNotify(alert: Alert, caregivers: readonly Caregiver[], log: Logger): string[] {
  const names: string[] = [];
  for (const id of alert.notified) {
    const caregiver = caregivers.find((c) => c.id === id);
    if (!caregiver) continue;
    names.push(caregiver.name);
    log.info(`NOTIFY (simulated) ${caregiver.channel} → ${caregiver.name}`, {
      alert: alert.id,
      severity: alert.severity,
      title: alert.title,
    });
  }
  return names;
}
