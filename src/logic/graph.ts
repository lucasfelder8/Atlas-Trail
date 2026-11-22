import type { CountryData } from './types.ts';

/** Adjacency list over playable countries only. */
export type Graph = Map<string, string[]>;

export function playableGraph(data: CountryData): Graph {
  const g: Graph = new Map();
  for (const c of Object.values(data.countries)) {
    if (!c.playable) continue;
    g.set(c.id, c.neighbors.filter((n) => data.countries[n]?.playable));
  }
  return g;
}

export function neighbors(g: Graph, id: string): string[] {
  return g.get(id) ?? [];
}

/** BFS distances (in edges = guesses) from `from` to every reachable node. */
export function distances(g: Graph, from: string): Map<string, number> {
  const d = new Map<string, number>([[from, 0]]);
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const x = q[i];
    for (const y of neighbors(g, x)) if (!d.has(y)) { d.set(y, d.get(x)! + 1); q.push(y); }
  }
  return d;
}

export function distance(g: Graph, a: string, b: string): number {
  return distances(g, a).get(b) ?? Infinity;
}

/**
 * A shortest path from a to b (inclusive), optionally restricted to nodes in `allowed`.
 * Ties are broken by neighbour order, so the result is deterministic.
 */
export function shortestPath(g: Graph, a: string, b: string, allowed?: Set<string>): string[] | null {
  const prev = new Map<string, string | null>([[a, null]]);
  const q = [a];
  for (let i = 0; i < q.length; i++) {
    const x = q[i];
    if (x === b) break;
    for (const y of neighbors(g, x)) {
      if (prev.has(y) || (allowed && !allowed.has(y))) continue;
      prev.set(y, x);
      q.push(y);
    }
  }
  if (!prev.has(b)) return null;
  const path: string[] = [];
  for (let x: string | null = b; x !== null; x = prev.get(x)!) path.push(x);
  return path.reverse();
}

/** Connected components (sorted largest first). */
export function components(g: Graph): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const id of g.keys()) {
    if (seen.has(id)) continue;
    const comp = [...distances(g, id).keys()];
    comp.forEach((c) => seen.add(c));
    out.push(comp);
  }
  return out.sort((x, y) => y.length - x.length);
}
