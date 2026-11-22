import type { Graph } from './graph.ts';
import { neighbors } from './graph.ts';

export const TOAST_ILLEGAL = 'Not next to your region';
export const TOAST_EXCLUDED = 'Not in play';

/** Visited set = start plus every valid guess. */
export function visitedSet(start: string, guesses: readonly string[]): Set<string> {
  return new Set([start, ...guesses]);
}

/** Legal = already visited, or borders ANY visited country. */
export function isLegal(g: Graph, visited: ReadonlySet<string>, id: string): boolean {
  if (!g.has(id)) return false;
  if (visited.has(id)) return true;
  return neighbors(g, id).some((n) => visited.has(n));
}

/** True once the target borders some visited country (the alert banner). */
export function targetIsAdjacent(g: Graph, visited: ReadonlySet<string>, target: string): boolean {
  return neighbors(g, target).some((n) => visited.has(n));
}

/**
 * Result of tapping a country. Illegal and excluded taps carry ONLY a toast message:
 * no id, no name, no card.
 */
export type TapResult =
  | { kind: 'toast'; message: string }
  | { kind: 'select'; id: string; visited: boolean; canGuess: boolean };

export function tap(
  g: Graph,
  visited: ReadonlySet<string>,
  id: string,
  gameOver: boolean,
): TapResult {
  if (!g.has(id)) return { kind: 'toast', message: TOAST_EXCLUDED };
  if (!isLegal(g, visited, id)) return { kind: 'toast', message: TOAST_ILLEGAL };
  const v = visited.has(id);
  return { kind: 'select', id, visited: v, canGuess: !v && !gameOver };
}
