/** Small, pure text helpers shared by the web components. */

/** "Alexa, what's my plan?" → "what's my plan?" (also handles "Hey Alexa" / "OK Alexa"). */
export function stripWakeWord(utterance: string): string {
  return utterance.replace(/^\s*(?:(?:hey|hi|ok|okay)[,\s]+)?alexa\b[\s,.!?:;-]*/i, '').trim();
}

function shortValue(value: unknown): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else if (Array.isArray(value)) text = value.map(shortValue).join(', ');
  else if (typeof value === 'object' && value !== null) text = JSON.stringify(value);
  else text = String(value);
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

/** `{ medication: 'lisinopril', confirmOverride: true }` → "medication: lisinopril · confirmOverride: true". */
export function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${key}: ${shortValue(value)}`);
  }
  return parts.join(' · ');
}

/** `us.anthropic.claude-haiku-4-5-20251001-v1:0` → "Claude Haiku 4.5". */
export function prettyModel(modelId?: string): string {
  const match = modelId ? /claude-([a-z]+)-(\d+)-(\d+)/i.exec(modelId) : null;
  if (!match) return 'Claude Haiku 4.5';
  const [, family = '', major = '', minor = ''] = match;
  return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}.${minor}`;
}

export function brainLabel(brain: 'bedrock' | 'rules', modelId?: string): string {
  return brain === 'bedrock' ? `Bedrock · ${prettyModel(modelId)}` : 'rule brain';
}

/** Local wall-clock time with seconds, for "updated at" footers. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatTokens(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

let counter = 0;

/** Unique enough for React keys within one session. */
export function newId(prefix = 'turn'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}
