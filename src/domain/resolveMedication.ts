/**
 * Maps what the elder said ("my blood pressure pill", "coumadin", "lisinapril") to one ACTIVE medication — or
 * explains why it could not. Pure string matching, no LLM: exact name/generic → brand alias → purpose keyword →
 * fuzzy (prefix / edit distance). Several hits at any stage are returned as `ambiguous` with a spoken question.
 *
 * The brand-alias map is deliberately tiny and local to this module (the interaction guardrail keeps its own).
 */
import type { Medication } from './model.js';

export type MedicationMatch =
  | { kind: 'match'; medication: Medication; via: 'name' | 'generic' | 'alias' | 'purpose' | 'fuzzy' }
  | { kind: 'ambiguous'; candidates: Medication[]; spoken: string }
  | { kind: 'none'; spoken: string };

type MatchVia = Extract<MedicationMatch, { kind: 'match' }>['via'];

const FILLER_WORDS: ReadonlySet<string> = new Set([
  'my',
  'the',
  'a',
  'an',
  'pill',
  'pills',
  'tablet',
  'tablets',
  'medication',
  'medicine',
  'meds',
  'med',
  'dose',
  'morning',
  'evening',
  'night',
  'one',
  'took',
  'take',
  'i',
]);

/** Brand → generic, for the handful of brands the demo household might say. */
const BRAND_ALIASES: Readonly<Record<string, string>> = {
  coumadin: 'warfarin',
  zestril: 'lisinopril',
  glucophage: 'metformin',
  norvasc: 'amlodipine',
  zocor: 'simvastatin',
  lipitor: 'atorvastatin',
  advil: 'ibuprofen',
  motrin: 'ibuprofen',
  tylenol: 'acetaminophen',
};

interface PurposeRule {
  /** Tested against the normalized query (whole words). */
  pattern: RegExp;
  /** A medication matches when its `purpose` contains any of these. */
  purposes: readonly string[];
}

const PURPOSE_RULES: readonly PurposeRule[] = [
  { pattern: /\bblood pressure\b|\bbp\b|\bpressure\b/, purposes: ['blood pressure'] },
  { pattern: /\bsugar\b|\bdiabet|\bglucose\b/, purposes: ['blood sugar'] },
  { pattern: /\bthinner\b|\bclot/, purposes: ['blood thinner'] },
  { pattern: /\bcholesterol\b|\bstatin\b/, purposes: ['cholesterol'] },
  { pattern: /\bheart\b/, purposes: ['blood pressure', 'blood thinner'] },
];

/** A query token of at least this length that starts a medication name is a match ("lisi" → Lisinopril). */
const MIN_PREFIX_LENGTH = 4;
/** Edit-distance matching only for tokens of at least this length ("warfrin" → Warfarin, but not "war"). */
const MIN_FUZZY_LENGTH = 5;
const MAX_EDIT_DISTANCE = 2;

/** Lowercases, strips punctuation, drops filler words and splits into tokens. */
export function normalizeMedicationQuery(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !FILLER_WORDS.has(token));
}

function normalizeName(name: string): string {
  return normalizeMedicationQuery(name).join(' ');
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/** Distinct normalized display + generic names of a medication. */
function namesOf(medication: Medication): string[] {
  return unique([normalizeName(medication.name), normalizeName(medication.genericName)].filter((n) => n.length > 0));
}

export function resolveMedication(query: string, medications: readonly Medication[]): MedicationMatch {
  const active = medications.filter((m) => m.active);
  const tokens = normalizeMedicationQuery(query);
  const normalized = tokens.join(' ');

  if (normalized.length > 0) {
    // 1. Exact name / generic name.
    const byName = active.filter((m) => normalizeName(m.name) === normalized);
    if (byName.length > 0) return decide(byName, 'name');
    const byGeneric = active.filter((m) => normalizeName(m.genericName) === normalized);
    if (byGeneric.length > 0) return decide(byGeneric, 'generic');

    // 2. Brand aliases ("coumadin" → warfarin).
    const aliased = unique(tokens.map((t) => BRAND_ALIASES[t]).filter((t): t is string => t !== undefined));
    if (aliased.length > 0) {
      const byAlias = active.filter((m) => namesOf(m).some((n) => aliased.includes(n)));
      if (byAlias.length > 0) return decide(byAlias, 'alias');
    }

    // 3. Purpose keywords ("sugar pill" → blood sugar).
    const purposes = unique(
      PURPOSE_RULES.filter((rule) => rule.pattern.test(normalized)).flatMap((rule) => rule.purposes)
    );
    if (purposes.length > 0) {
      const byPurpose = active.filter((m) => {
        const purpose = (m.purpose ?? '').toLowerCase();
        return purposes.some((needle) => purpose.includes(needle));
      });
      if (byPurpose.length > 0) return decide(byPurpose, 'purpose');
    }

    // 4. Fuzzy: prefix or small edit distance against name / generic ("lisinapril", "metformen", "warfrin").
    const byFuzzy = active.filter((m) => namesOf(m).some((name) => tokens.some((token) => fuzzyMatches(token, name))));
    if (byFuzzy.length > 0) return decide(byFuzzy, 'fuzzy');
  }

  return { kind: 'none', spoken: noneSpoken(query, active) };
}

function decide(candidates: Medication[], via: MatchVia): MedicationMatch {
  const only = candidates[0];
  if (candidates.length === 1 && only) return { kind: 'match', medication: only, via };
  return { kind: 'ambiguous', candidates, spoken: `Do you mean ${candidates.map((m) => m.name).join(' or ')}?` };
}

function noneSpoken(query: string, active: readonly Medication[]): string {
  const asked = query.trim() || 'that';
  const names = active.map((m) => m.name);
  const list =
    names.length > 0 ? `Your active medications are ${names.join(', ')}.` : 'There are no active medications on file.';
  return `I couldn't find a medication called ${asked}. ${list}`;
}

/** `name` may be multi-word ("vitamin d"); a token may match the whole name or any single word of it. */
function fuzzyMatches(token: string, name: string): boolean {
  const parts = unique([name, ...name.split(' ')]);
  if (token.length >= MIN_PREFIX_LENGTH && parts.some((part) => part.startsWith(token))) return true;
  if (token.length >= MIN_FUZZY_LENGTH && parts.some((part) => levenshtein(token, part) <= MAX_EDIT_DISTANCE))
    return true;
  return false;
}

/** Classic two-row Levenshtein edit distance; inputs are short (single words). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  let current: number[] = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + substitution);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length] ?? 0;
}
