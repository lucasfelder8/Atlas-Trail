import type { Graph } from './graph.ts';
import { distances } from './graph.ts';
import { parOf, parGraph } from './par.ts';
import { PAR_AVOIDS, GAME_NAME, SHARE_URL } from '../../config/game.config.ts';

/** Score = total valid guesses (the winning guess included). */
export const score = (guesses: readonly string[]) => guesses.length;

/** Par = shortest number of guesses from start to target, avoiding the giant countries when possible. */
export function par(g: Graph, start: string, target: string): number {
  return parOf(g, start, target);
}

function onShortestRoute(g: Graph, start: string, target: string): (c: string) => boolean {
  const ds = distances(g, start), dt = distances(g, target);
  const total = ds.get(target) ?? Infinity;
  return (c) => (ds.get(c) ?? Infinity) + (dt.get(c) ?? Infinity) === total;
}

/**
 * One square per guess: green if the country lies on SOME shortest route
 * (d(start,c) + d(c,target) = d(start,target)), yellow for a detour. The last guess is always green.
 * Both the par route (avoiding giant countries) and the true shortest route count as green.
 */
export function shareSquares(
  g: Graph, start: string, target: string, guesses: readonly string[], avoid: readonly string[] = PAR_AVOIDS,
): string[] {
  const onFull = onShortestRoute(g, start, target);
  const onPar = onShortestRoute(parGraph(g, start, target, avoid), start, target);
  return guesses.map((c, i) => {
    if (i === guesses.length - 1) return '🟩';
    return onFull(c) || onPar(c) ? '🟩' : '🟨';
  });
}

/** puzzleNumber null = practice puzzle. */
export function shareText(puzzleNumber: number | null, guessCount: number, parValue: number, squares: string[]): string {
  const word = guessCount === 1 ? 'guess' : 'guesses';
  const title = puzzleNumber === null ? `${GAME_NAME} (practice)` : `${GAME_NAME} #${puzzleNumber}`;
  return `${title} - ${guessCount} ${word} (par ${parValue})\n${squares.join('')}${SHARE_URL ? `\n${SHARE_URL}` : ''}`;
}
