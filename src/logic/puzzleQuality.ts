import type { Graph } from './graph.ts';
import { distances } from './graph.ts';
import { buildHints, evaluateHint, type HintContext } from './hints.ts';
import { parGraph } from './par.ts';

/**
 * Does some country on a par route (other than the target) match at least one
 * checkable hint? Puzzles failing this show ✗ on every card until the final guess.
 */
export function routeHasMatch(g: Graph, ctx: HintContext, start: string, target: string, par: number): boolean {
  const t = ctx.countries[target];
  const hints = buildHints(t, par, ctx).filter((h) => h.kind !== 'landmark');
  const pg = parGraph(g, start, target);
  const ds = distances(pg, start), dt = distances(pg, target);
  for (const [id, d] of ds) {
    if (id === target || d + (dt.get(id) ?? Infinity) !== par) continue;
    if (hints.some((h) => evaluateHint(h, t, ctx.countries[id], ctx).match)) return true;
  }
  return false;
}
