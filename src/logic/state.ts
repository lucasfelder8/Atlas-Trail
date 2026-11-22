// Pure game-state and stats transitions. Persistence lives in src/ui/storage.ts.

export type GameStatus = 'playing' | 'won' | 'gaveup';

export interface GameState {
  number: number;
  start: string;
  target: string;
  guesses: string[];
  status: GameStatus;
  /** Hint indices the player opened in the "show matching countries" map helper. One 💡 each when sharing. */
  helpedHints?: number[];
}

export interface DayResult {
  status: 'won' | 'gaveup';
  guesses: number;
  par: number;
  /** Number of hints the player looked up on the map (💡 count). */
  helpers?: number;
}

export interface Stats {
  played: number;
  wins: number;
  currentStreak: number;
  maxStreak: number;
  /** Puzzle number of the most recent win that extended the streak. */
  lastWin: number | null;
  /** guess count -> number of wins with that many guesses */
  distribution: Record<number, number>;
  totalWinGuesses: number;
  results: Record<number, DayResult>;
}

export const emptyStats = (): Stats => ({
  played: 0, wins: 0, currentStreak: 0, maxStreak: 0, lastWin: null,
  distribution: {}, totalWinGuesses: 0, results: {},
});

export const newGame = (number: number, start: string, target: string): GameState =>
  ({ number, start, target, guesses: [], status: 'playing' });

/** Commit a guess (caller has checked legality). Guessing the target wins. Guesses are permanent. */
export function applyGuess(s: GameState, id: string): GameState {
  if (s.status !== 'playing' || s.guesses.includes(id) || id === s.start) return s;
  const guesses = [...s.guesses, id];
  return { ...s, guesses, status: id === s.target ? 'won' : 'playing' };
}

/** Mark the game as played with the hint helper (permanent for this game). */
export const helperCount = (s: GameState) => s.helpedHints?.length ?? 0;

/** Look up one hint on the map. Each distinct hint costs one 💡; viewing the same hint again is free. */
export const useHelper = (s: GameState, hintIndex: number): GameState =>
  s.status !== 'playing' || s.helpedHints?.includes(hintIndex) ? s : { ...s, helpedHints: [...(s.helpedHints ?? []), hintIndex] };

export const giveUp = (s: GameState): GameState => (s.status === 'playing' ? { ...s, status: 'gaveup' } : s);

/** Record a finished game into stats. Idempotent per puzzle number. */
export function recordResult(st: Stats, game: GameState, parValue: number): Stats {
  if (game.status === 'playing' || st.results[game.number]) return st;
  const won = game.status === 'won';
  const n = game.guesses.length;
  const next: Stats = {
    ...st,
    played: st.played + 1,
    results: { ...st.results, [game.number]: { status: game.status, guesses: n, par: parValue, ...(helperCount(game) ? { helpers: helperCount(game) } : {}) } },
  };
  if (won) {
    next.wins = st.wins + 1;
    next.currentStreak = st.lastWin === game.number - 1 ? st.currentStreak + 1 : 1;
    next.maxStreak = Math.max(st.maxStreak, next.currentStreak);
    next.lastWin = game.number;
    next.distribution = { ...st.distribution, [n]: (st.distribution[n] ?? 0) + 1 };
    next.totalWinGuesses = st.totalWinGuesses + n;
  } else {
    next.currentStreak = 0;
    next.lastWin = null;
  }
  return next;
}

/** Streak as of today: broken if yesterday's puzzle was not won (and today's isn't won yet). */
export function displayStreak(st: Stats, today: number): number {
  if (st.lastWin === null) return 0;
  return st.lastWin >= today - 1 ? st.currentStreak : 0;
}

export const winRate = (st: Stats) => (st.played ? Math.round((100 * st.wins) / st.played) : 0);
export const averageGuesses = (st: Stats) => (st.wins ? st.totalWinGuesses / st.wins : 0);
