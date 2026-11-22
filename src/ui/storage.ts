import type { Puzzle } from '../logic/types.ts';
import type { GameState, Stats } from '../logic/state.ts';
import { emptyStats } from '../logic/state.ts';

const GAME_KEY = 'mystery-destination:game';
const STATS_KEY = 'mystery-destination:stats';
const SEEN_HELP_KEY = 'mystery-destination:seen-help';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export const loadGame = () => read<GameState>(GAME_KEY);
export const saveGame = (g: GameState) => write(GAME_KEY, g);
export const loadStats = (): Stats => ({ ...emptyStats(), ...(read<Stats>(STATS_KEY) ?? {}) });
export const saveStats = (s: Stats) => write(STATS_KEY, s);
export const hasSeenHelp = () => read<boolean>(SEEN_HELP_KEY) === true;
export const markHelpSeen = () => write(SEEN_HELP_KEY, true);

const PREF_KEY = 'mystery-destination:prefs';
export type Difficulty = 'easy' | 'medium' | 'hard' | 'any';
export interface Prefs { hintsCollapsed?: boolean; practiceDifficulty?: Difficulty }
export const loadPrefs = (): Prefs => read<Prefs>(PREF_KEY) ?? {};
export const savePrefs = (p: Prefs) => write(PREF_KEY, p);

// Practice games are stored separately and never touch daily stats or streaks.
const PRACTICE_KEY = 'mystery-destination:practice';
export interface PracticeSave { puzzle: Omit<Puzzle, 'number' | 'date'>; game: GameState }
export const loadPractice = () => read<PracticeSave>(PRACTICE_KEY);
export const savePractice = (p: PracticeSave) => write(PRACTICE_KEY, p);
