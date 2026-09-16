import { randomUUID } from 'node:crypto';

/** Short prefixed ids (`alert_3f9c1a2b7d`) — readable in logs and speakable-ish in tests. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}
