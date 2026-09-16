/**
 * Timezone helpers built on Intl only (no date library). Everything the household sees — "today", schedule
 * slots, spoken times — is computed in the household's IANA timezone; everything stored is UTC.
 */
import type { ClockTime, IsoDateTime, LocalDate } from './model.js';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock shifted by a fixed number of minutes — used for reproducible demos (`DEMO_CLOCK_OFFSET_MIN`). */
export function offsetClock(base: Clock, offsetMin: number): Clock {
  return { now: () => new Date(base.now().getTime() + offsetMin * 60_000) };
}

/** A frozen clock for tests. */
export function fixedClock(iso: IsoDateTime): Clock {
  const at = new Date(iso);
  return { now: () => new Date(at.getTime()) };
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let dtf = partsCache.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'long',
    });
    partsCache.set(tz, dtf);
  }
  return dtf;
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
}

/** The wall-clock reading of `instant` in `tz`. */
export function wallClock(instant: Date | IsoDateTime, tz: string): WallClock {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday ?? '',
  };
}

/** Offset of `tz` at `instant`, in minutes east of UTC (e.g. -420 for PDT, +330 for IST). */
export function tzOffsetMinutes(instant: Date, tz: string): number {
  const w = wallClock(instant, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toLocalDate(instant: Date | IsoDateTime, tz: string): LocalDate {
  const w = wallClock(instant, tz);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

export function toClockTime(instant: Date | IsoDateTime, tz: string): ClockTime {
  const w = wallClock(instant, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

export function parseLocalDate(localDate: LocalDate): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!m) throw new Error(`invalid LocalDate: ${localDate}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function parseClockTime(time: ClockTime): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) throw new Error(`invalid ClockTime: ${time}`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new Error(`invalid ClockTime: ${time}`);
  return { hour, minute };
}

/** Resolves a wall-clock moment in `tz` to a UTC instant (DST-safe: re-derives the offset at the candidate). */
export function zonedToUtc(localDate: LocalDate, time: ClockTime, tz: string): Date {
  const d = parseLocalDate(localDate);
  const t = parseClockTime(time);
  const guess = Date.UTC(d.year, d.month - 1, d.day, t.hour, t.minute, 0);
  const first = tzOffsetMinutes(new Date(guess), tz);
  let candidate = guess - first * 60_000;
  const second = tzOffsetMinutes(new Date(candidate), tz);
  if (second !== first) candidate = guess - second * 60_000;
  return new Date(candidate);
}

export function startOfLocalDay(localDate: LocalDate, tz: string): Date {
  return zonedToUtc(localDate, '00:00', tz);
}

export function addDays(localDate: LocalDate, days: number): LocalDate {
  const d = parseLocalDate(localDate);
  const shifted = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  const a = parseLocalDate(from);
  const b = parseLocalDate(to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

export function minutesBetween(from: Date | IsoDateTime, to: Date | IsoDateTime): number {
  const a = typeof from === 'string' ? new Date(from).getTime() : from.getTime();
  const b = typeof to === 'string' ? new Date(to).getTime() : to.getTime();
  return (b - a) / 60_000;
}

export function addMinutes(instant: Date | IsoDateTime, minutes: number): Date {
  const t = typeof instant === 'string' ? new Date(instant).getTime() : instant.getTime();
  return new Date(t + minutes * 60_000);
}

export function isoOf(instant: Date): IsoDateTime {
  return instant.toISOString();
}

/** `08:00` → "8 a.m.", `18:30` → "6:30 p.m.", `12:00` → "noon", `00:00` → "midnight". */
export function spokenClockTime(time: ClockTime): string {
  const { hour, minute } = parseClockTime(time);
  if (hour === 0 && minute === 0) return 'midnight';
  if (hour === 12 && minute === 0) return 'noon';
  const suffix = hour < 12 ? 'a.m.' : 'p.m.';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${h12} ${suffix}` : `${h12}:${pad(minute)} ${suffix}`;
}

export function spokenTime(instant: Date | IsoDateTime, tz: string): string {
  return spokenClockTime(toClockTime(instant, tz));
}

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
];

/** "today" / "tomorrow" / "yesterday" / "Thursday" (within a week) / "September 25". */
export function spokenDay(localDate: LocalDate, today: LocalDate, tz: string): string {
  const diff = daysBetween(today, localDate);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff > 1 && diff < 7) return wallClock(startOfLocalDay(localDate, tz), tz).weekday;
  const d = parseLocalDate(localDate);
  return `${MONTHS[d.month - 1]} ${d.day}`;
}

/** A human-friendly relative stamp, e.g. "today at 8:05 a.m." or "yesterday at 6:10 p.m.". */
export function spokenDateTime(instant: Date | IsoDateTime, tz: string, today: LocalDate): string {
  return `${spokenDay(toLocalDate(instant, tz), today, tz)} at ${spokenTime(instant, tz)}`;
}
