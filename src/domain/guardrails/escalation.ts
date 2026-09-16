/**
 * Symptom triage and caregiver escalation for check-ins and the "help" tool. Keyword bands (emergency / urgent /
 * watch) are matched on word boundaries after light normalization; the result is a decision the caller acts on —
 * it creates the alert via `createAlert()` and says `spoken` (the emergency guidance first and verbatim).
 */
import type { AlertSpec } from '../alerts.js';
import type { Caregiver, Elder, Household, SymptomSeverity } from '../model.js';
import { spokenTime } from '../time.js';

export interface SymptomClassification {
  severity: SymptomSeverity;
  /** The phrases that matched, most serious band first. */
  matched: string[];
}

export interface EscalationInput {
  elder: Elder;
  household: Household;
  caregivers: Caregiver[];
  mood?: string;
  symptomsText: string;
  source: 'checkin' | 'help';
  at: Date;
}

export interface EscalationResult {
  severity: SymptomSeverity;
  flagged: boolean;
  /** Present for emergencies; the host must say it first and verbatim. */
  emergencyGuidance?: string;
  /** The alert to create via `createAlert()`; absent when nothing needs recording. */
  alertSpec?: AlertSpec;
  /** Caregiver ids the alert notifies (empty for dashboard-only notes). */
  notified: string[];
  spoken: string;
}

export const EMERGENCY_PHRASES: readonly string[] = [
  'chest pain',
  'chest pains',
  'chest hurts',
  'chest is tight',
  'pressure in my chest',
  'tightness in my chest',
  'cannot breathe',
  'cannot breath',
  'could not breathe',
  'could not breath',
  'trouble breathing',
  'hard to breathe',
  'difficulty breathing',
  'struggling to breathe',
  'short of breath',
  'shortness of breath',
  'fell',
  'fall',
  'fallen',
  'fell down',
  'had a fall',
  'took a fall',
  'stroke',
  'face drooping',
  'face is drooping',
  'slurred speech',
  'slurring',
  'unconscious',
  'passed out',
  'fainted',
  'heavy bleeding',
  'bleeding a lot',
  'bleeding heavily',
  'overdose',
  'took too many',
  'throat swelling',
  'throat is swelling',
  'cannot swallow',
];

export const URGENT_PHRASES: readonly string[] = [
  'dizzy',
  'dizziness',
  'lightheaded',
  'light headed',
  'faint',
  'feel faint',
  'confused',
  'confusion',
  'vomiting',
  'vomited',
  'throwing up',
  'threw up',
  'high fever',
  'fever',
  'blood in urine',
  'blood in my urine',
  'blood in stool',
  'blood in my stool',
  'severe pain',
  'bad pain',
  'terrible pain',
  'a lot of pain',
  'cannot sleep at all',
  'very weak',
];

export const WATCH_PHRASES: readonly string[] = [
  'tired',
  'exhausted',
  'headache',
  'nausea',
  'nauseous',
  'nauseated',
  'low',
  'sad',
  'down',
  'lonely',
  'depressed',
  'anxious',
  'poor sleep',
  'did not sleep',
  'could not sleep',
  'slept badly',
  'swollen ankles',
  'swelling',
  'swollen',
  'sore',
  'achy',
  'aching',
  'stomach ache',
  'stomach hurts',
  'upset stomach',
  'no appetite',
  'cough',
  'coughing',
];

const SEVERITY_RANK: Record<SymptomSeverity, number> = { none: 0, watch: 1, urgent: 2, emergency: 3 };

/** Everyday phrases that contain an emergency keyword but are not one. */
const BENIGN_RE = /\b(?:fall|fell|falling|fallen)(?: back)? asleep\b/g;

function phraseRegex(phrase: string): RegExp {
  return new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
}

const MATCHERS: ReadonlyArray<{ severity: SymptomSeverity; phrases: ReadonlyArray<{ phrase: string; re: RegExp }> }> = [
  { severity: 'emergency', phrases: EMERGENCY_PHRASES.map((phrase) => ({ phrase, re: phraseRegex(phrase) })) },
  { severity: 'urgent', phrases: URGENT_PHRASES.map((phrase) => ({ phrase, re: phraseRegex(phrase) })) },
  { severity: 'watch', phrases: WATCH_PHRASES.map((phrase) => ({ phrase, re: phraseRegex(phrase) })) },
];

/** Lowercase, contractions expanded ("can't" → "cannot", "I'm" → "i am"), punctuation stripped, spaces collapsed. */
export function normalizeSymptomText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\bcan'?t\b/g, 'cannot')
    .replace(/\bcan not\b/g, 'cannot')
    .replace(/\bcouldn'?t\b/g, 'could not')
    .replace(/\bdidn'?t\b/g, 'did not')
    .replace(/\bwon'?t\b/g, 'will not')
    .replace(/\bi'?m\b/g, 'i am')
    .replace(/\bi'?ve\b/g, 'i have')
    .replace(/\bisn'?t\b/g, 'is not')
    .replace(/\bdon'?t\b/g, 'do not')
    .replace(/\bdoesn'?t\b/g, 'does not')
    .replace(/\bhaven'?t\b/g, 'have not')
    .replace(/\bwasn'?t\b/g, 'was not')
    .replace(/\bit'?s\b/g, 'it is')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The highest band any phrase hits; `matched` drops phrases contained in a longer hit ("fell" inside "fell down"). */
export function classifySymptoms(text: string): SymptomClassification {
  const normalized = normalizeSymptomText(text).replace(BENIGN_RE, ' ');
  let severity: SymptomSeverity = 'none';
  const hits: string[] = [];
  for (const band of MATCHERS) {
    for (const { phrase, re } of band.phrases) {
      if (!re.test(normalized)) continue;
      hits.push(phrase);
      if (SEVERITY_RANK[band.severity] > SEVERITY_RANK[severity]) severity = band.severity;
    }
  }
  const matched = hits.filter((p) => !hits.some((other) => other !== p && other.includes(p)));
  return { severity, matched };
}

const LOW_MOOD_RE =
  /\b(?:bad|awful|terrible|horrible|low|sad|down|poorly|unwell|lousy|miserable|rough|depressed|anxious|lonely)\b|\bnot (?:so |too |very |that |really )?(?:good|great|well)\b/;
const NOT_BAD_RE = /\bnot (?:so |too |very |that |really )?(?:bad|awful|terrible|horrible)\b/;

/** "bad", "pretty low", "not good" — but not "not bad". A symptom word in the mood also counts. */
export function isLowMood(mood: string | undefined): boolean {
  if (!mood) return false;
  const normalized = normalizeSymptomText(mood);
  if (normalized === '') return false;
  if (LOW_MOOD_RE.test(normalized) && !NOT_BAD_RE.test(normalized)) return true;
  return classifySymptoms(normalized).severity !== 'none';
}

/** "Maria", "Maria and Ben", "Maria, Ben and Lily". */
function spokenList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function guidance(household: Household, names: string): string {
  const base = `This could be an emergency. Please call ${household.emergencyNumber} right now.`;
  return names === '' ? base : `${base} I'm alerting ${names}.`;
}

/** `At 8:15 a.m., Rosa said "I can't breathe" and was feeling "bad". Matched: cannot breathe.` */
function describeReport(elder: Elder, text: string, mood: string, when: string, matched: readonly string[]): string {
  const bits: string[] = [];
  if (text !== '') bits.push(`said "${text}"`);
  if (mood !== '') bits.push(`was feeling "${mood}"`);
  if (bits.length === 0) bits.push('gave no details');
  const matchedNote = matched.length > 0 ? ` Matched: ${matched.join(', ')}.` : '';
  return `At ${when}, ${elder.name} ${bits.join(' and ')}.${matchedNote}`;
}

export function evaluateEscalation(input: EscalationInput): EscalationResult {
  const { elder, household, at } = input;
  const text = input.symptomsText.trim();
  const mood = (input.mood ?? '').trim();
  const caregivers = [...input.caregivers].sort((a, b) => a.escalationPriority - b.escalationPriority);
  const first = caregivers[0];
  const everyone = caregivers.map((c) => c.id);
  const names = spokenList(caregivers.map((c) => c.name));
  const when = spokenTime(at, household.timezone);
  const classification = classifySymptoms(text);
  const base = { elderId: elder.id, dedupeKey: undefined } as const;

  if (input.source === 'help') {
    const emergencyGuidance = guidance(household, names);
    return {
      severity: 'emergency',
      flagged: true,
      emergencyGuidance,
      alertSpec: {
        ...base,
        type: 'help',
        severity: 'critical',
        title: 'Help requested',
        detail: `At ${when}, ${elder.name} asked for help${text === '' ? '' : `: "${text}"`}.`,
        notified: everyone,
      },
      notified: everyone,
      spoken: emergencyGuidance,
    };
  }

  const severity: SymptomSeverity =
    classification.severity === 'none' && isLowMood(mood) ? 'watch' : classification.severity;
  const detail = describeReport(elder, text, mood, when, classification.matched);

  switch (severity) {
    case 'emergency': {
      const emergencyGuidance = guidance(household, names);
      return {
        severity,
        flagged: true,
        emergencyGuidance,
        alertSpec: {
          ...base,
          type: 'symptom',
          severity: 'critical',
          title: 'Emergency symptoms reported',
          detail,
          notified: everyone,
        },
        notified: everyone,
        spoken: emergencyGuidance,
      };
    }
    case 'urgent': {
      const notified = first ? [first.id] : [];
      const told = first ? `I've let ${first.name} know right away.` : `I've noted it for your family.`;
      return {
        severity,
        flagged: true,
        alertSpec: {
          ...base,
          type: 'symptom',
          severity: 'critical',
          title: 'Urgent symptoms reported',
          detail,
          notified,
        },
        notified,
        spoken: `That sounds worth a call. ${told} If it gets worse, call ${household.emergencyNumber}.`,
      };
    }
    case 'watch': {
      const noted = first ? `I've noted it for ${first.name} to see.` : `I've noted it.`;
      return {
        severity,
        flagged: true,
        alertSpec: { ...base, type: 'symptom', severity: 'info', title: 'Symptoms to watch', detail, notified: [] },
        notified: [],
        spoken: `Thanks for telling me. ${noted} Take it easy today.`,
      };
    }
    case 'none':
      return { severity, flagged: false, notified: [], spoken: `Glad to hear it. I've logged your check-in.` };
  }
}
