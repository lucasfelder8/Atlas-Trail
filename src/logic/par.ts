import { PAR_AVOIDS } from '../../config/game.config.ts';
import type { Graph } from './graph.ts';
import { distance } from './graph.ts';

/**
 * The graph par is measured on: the playable graph without the giant countries (except when
 * they are the start or target). Falls back to the full graph when there is no way around them
 * (e.g. Mongolia, which only borders Russia and China).
 */
export function parGraph(g: Graph, start: string, target: string, avoid: readonly string[] = PAR_AVOIDS): Graph {
  const blocked = new Set(avoid.filter((x) => x !== start && x !== target && g.has(x)));
  if (!blocked.size) return g;
  const sub: Graph = new Map();
  for (const [k, v] of g) if (!blocked.has(k)) sub.set(k, v.filter((n) => !blocked.has(n)));
  return distance(sub, start, target) < Infinity ? sub : g;
}

/** Par = number of guesses on the shortest route that avoids the giant countries (when possible). */
export function parOf(g: Graph, start: string, target: string, avoid: readonly string[] = PAR_AVOIDS): number {
  return distance(parGraph(g, start, target, avoid), start, target);
}
