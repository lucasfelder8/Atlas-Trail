import { LAUNCH_DATE, TIME_ZONE } from '../../config/game.config.ts';

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Calendar date (YYYY-MM-DD) in America/Los_Angeles at instant `now`. */
export function laDate(now: Date = new Date()): string {
  return fmt.format(now);
}

const dayIndex = (ymd: string) => Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);

export function addDays(ymd: string, n: number): string {
  return new Date((dayIndex(ymd) + n) * 86_400_000).toISOString().slice(0, 10);
}

/** Puzzle number for a date: LAUNCH_DATE is #1. */
export function puzzleNumber(ymd: string, launch: string = LAUNCH_DATE): number {
  return dayIndex(ymd) - dayIndex(launch) + 1;
}

/** Milliseconds until the next Los Angeles midnight (DST-safe). */
export function msUntilNextPuzzle(now: Date = new Date()): number {
  const today = laDate(now);
  // Walk forward in coarse then fine steps until the LA date changes.
  let lo = now.getTime();
  let hi = lo + 26 * 3_600_000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (laDate(new Date(mid)) === today) lo = mid; else hi = mid;
  }
  return hi - now.getTime();
}

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
