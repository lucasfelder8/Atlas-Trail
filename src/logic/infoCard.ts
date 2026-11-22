import type { Graph } from './graph.ts';
import { tap } from './legality.ts';
import type { CardLine, Hint, HintContext } from './hints.ts';
import { evaluateHint } from './hints.ts';
import type { Country } from './types.ts';

export interface CardRow extends CardLine {
  /**
   * The target's value for the same hint, so the player sees what was compared.
   * It never reveals more than the hint text already says. null for the landmark.
   */
  targetValue: string | null;
}

export interface CardModel {
  id: string;
  name: string;
  rows: CardRow[];
  /** Checkable hints that match / total checkable hints (landmark excluded). */
  matches: number;
  checkable: number;
  showGuessButton: boolean;
}

/**
 * The info card for a tapped country, or null when the tap is illegal/excluded.
 * This is the only place a country's name reaches the UI for an unvisited country,
 * and it is gated by `tap()`.
 */
export function cardFor(
  g: Graph,
  visited: ReadonlySet<string>,
  id: string,
  target: Country,
  revealed: readonly Hint[],
  ctx: HintContext,
  gameOver: boolean,
): CardModel | null {
  const r = tap(g, visited, id, gameOver);
  if (r.kind !== 'select') return null;
  const c = ctx.countries[r.id];
  const rows: CardRow[] = revealed.map((h) => ({
    ...evaluateHint(h, target, c, ctx),
    targetValue: h.kind === 'landmark' ? null : evaluateHint(h, target, target, ctx).value,
  }));
  const checkable = rows.filter((x) => x.match !== null);
  return {
    id: c.id,
    name: c.name,
    rows,
    matches: checkable.filter((x) => x.match).length,
    checkable: checkable.length,
    showGuessButton: r.canGuess,
  };
}

/**
 * 0..4: how strongly a country matches the revealed checkable hints (used to shade visited
 * countries). 0 = none match, 4 = all match.
 */
export function matchLevel(country: Country, target: Country, revealed: readonly Hint[], ctx: HintContext): number {
  const checkable = revealed.filter((h) => h.kind !== 'landmark');
  if (!checkable.length) return 0;
  const m = checkable.filter((h) => evaluateHint(h, target, country, ctx).match).length;
  return Math.round((4 * m) / checkable.length);
}
