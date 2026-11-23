import type { Graph } from './graph.ts';
import { distances } from './graph.ts';
import { buildHints, leaksTarget, type HintContext } from './hints.ts';
import { parOf } from './par.ts';
import { routeHasMatch } from './puzzleQuality.ts';
import { pick } from './rng.ts';

export interface PickOptions {
  minPar: number;
  maxPar: number;
  requireRouteMatch: boolean;
  /** Targets not allowed this time (e.g. used recently). */
  avoidTargets?: ReadonlySet<string>;
  /** Starts not allowed this time (e.g. countries that appeared recently). */
  avoidStarts?: ReadonlySet<string>;
}

/** Countries that can be targets: a landmark that doesn't leak, and enough hints for minPar. */
export function eligibleTargets(g: Graph, ctx: HintContext, minPar: number): string[] {
  return [...g.keys()].filter((id) => {
    const c = ctx.countries[id];
    return c.landmark && !leaksTarget(c.landmark, c) && buildHints(c, minPar, ctx).length === minPar;
  }).sort();
}

/** Pick a random start/target pair satisfying the rules, or null after too many attempts. */
export function pickPuzzle(
  rand: () => number, g: Graph, ctx: HintContext, targets: readonly string[], o: PickOptions,
): { start: string; target: string; par: number } | null {
  for (let attempt = 0; attempt < 400; attempt++) {
    const target = pick(rand, targets);
    if (o.avoidTargets?.has(target)) continue;
    const sameComponent = [...distances(g, target).keys()].filter((s) => s !== target).sort();
    const starts = sameComponent.filter((s) => { if (o.avoidStarts?.has(s)) return false; const p = parOf(g, s, target); return p >= o.minPar && p <= o.maxPar; });
    if (!starts.length) continue;
    const start = pick(rand, starts);
    const par = parOf(g, start, target);
    if (buildHints(ctx.countries[target], par, ctx).length !== par) continue;
    if (o.requireRouteMatch && !routeHasMatch(g, ctx, start, target, par)) continue;
    return { start, target, par };
  }
  return null;
}
