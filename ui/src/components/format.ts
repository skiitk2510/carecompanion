/**
 * Tiny, dependency-free formatting helpers for the Dashboard. The payload already carries spoken strings for most
 * things ("8 a.m.", "tomorrow at 2 p.m."); these cover the rest — `HH:mm` schedule times, `YYYY-MM-DD` local dates
 * and ISO instants — without importing the server's time module (the ui/ project only sees the shared types).
 */

const pad2 = (n: number): string => String(n).padStart(2, '0');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function parseLocalDate(localDate: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function parseClockTime(time: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** `08:00` → "8 a.m.", `18:30` → "6:30 p.m.", `12:00` → "noon", `00:00` → "midnight" (mirrors src/domain/time.ts). */
export function spokenClockTime(time: string): string {
  const t = parseClockTime(time);
  if (!t) return time;
  if (t.hour === 0 && t.minute === 0) return 'midnight';
  if (t.hour === 12 && t.minute === 0) return 'noon';
  const suffix = t.hour < 12 ? 'a.m.' : 'p.m.';
  const h12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  return t.minute === 0 ? `${h12} ${suffix}` : `${h12}:${pad2(t.minute)} ${suffix}`;
}

/** The calendar day as a UTC instant (no zone shift), so weekday and month math is stable in any browser zone. */
function utcDayOf(localDate: string): Date | null {
  const d = parseLocalDate(localDate);
  return d ? new Date(Date.UTC(d.year, d.month - 1, d.day)) : null;
}

export function weekdayName(localDate: string): string {
  const day = utcDayOf(localDate);
  return day ? (WEEKDAYS[day.getUTCDay()] ?? '') : '';
}

/** `2026-09-16` → "W". */
export function weekdayInitial(localDate: string): string {
  return weekdayName(localDate).charAt(0);
}

/** `2026-09-16` → "Wednesday, September 16". */
export function longLocalDate(localDate: string): string {
  const d = parseLocalDate(localDate);
  if (!d) return localDate;
  return `${weekdayName(localDate)}, ${MONTHS[d.month - 1] ?? ''} ${d.day}`;
}

/** `2026-09-16` → "Sep 16". */
export function shortLocalDate(localDate: string): string {
  const d = parseLocalDate(localDate);
  if (!d) return localDate;
  return `${(MONTHS[d.month - 1] ?? '').slice(0, 3)} ${d.day}`;
}

/** Whole days from `from` to `to` (negative when `to` is earlier); null when either is malformed. */
export function daysBetween(from: string, to: string): number | null {
  const a = utcDayOf(from);
  const b = utcDayOf(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** "today" / "yesterday" / "tomorrow" / a weekday name (within a week) / "Sep 9". */
export function relativeDay(localDate: string, today: string): string {
  const diff = daysBetween(today, localDate);
  if (diff === null) return localDate;
  if (diff === 0) return 'today';
  if (diff === -1) return 'yesterday';
  if (diff === 1) return 'tomorrow';
  if (Math.abs(diff) < 7) return weekdayName(localDate);
  return shortLocalDate(localDate);
}

/**
 * An ISO instant as a wall-clock time — in `timeZone` when given and valid, otherwise in the viewer's own zone.
 * Empty string for an unparsable instant.
 */
export function clockOf(iso: string, timeZone?: string, withSeconds = false): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  if (withSeconds) options.second = '2-digit';
  try {
    return new Intl.DateTimeFormat(undefined, timeZone ? { ...options, timeZone } : options).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
}

/** 0.929 → "93%", null → "—". */
export function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** ["Priya"] → "Priya"; ["Priya", "Daniel"] → "Priya and Daniel"; three or more → "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** First name for compact labels ("Priya Hart-Singh" → "Priya"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** Cuts long prose near `max` characters, preferring a word boundary. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return 'Something went wrong. Please try again.';
}
