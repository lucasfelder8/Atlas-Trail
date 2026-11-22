// Optional, fire-and-forget upload of finished daily games for the admin panel.
// Does nothing unless SUPABASE_URL and SUPABASE_ANON_KEY are set in config/game.config.ts.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../config/game.config.ts';
import type { GameState } from '../logic/state.ts';

const ID_KEY = 'mystery-destination:player-id';

/** Anonymous, random, per-browser id. Never derived from anything about the person. */
export function playerId(): string {
  try {
    const have = localStorage.getItem(ID_KEY);
    if (have) return have;
    const id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** Safe to call repeatedly: the database ignores a second row for the same player and puzzle. */
export function submitResult(game: GameState, par: number): void {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || game.status === 'playing') return;
  const row = {
    player_id: playerId(),
    puzzle_number: game.number,
    status: game.status,
    guesses: game.guesses.length,
    par,
    start: game.start,
    target: game.target,
    route: game.guesses,
  };
  fetch(`${SUPABASE_URL}/rest/v1/results?on_conflict=player_id,puzzle_number`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
    keepalive: true,
  }).catch(() => { /* offline: it will be retried the next time the finished game loads */ });
}
