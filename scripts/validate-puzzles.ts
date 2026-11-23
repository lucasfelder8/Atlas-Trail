// Validate public/data/puzzles.json. Exits nonzero on any failure.
//   node scripts/validate-puzzles.ts
import { MIN_PAR, MAX_PAR, TARGET_REPEAT_DAYS, LAUNCH_DATE, REQUIRE_ROUTE_MATCH } from '../config/game.config.ts';
import { playableGraph, distance } from '../src/logic/graph.ts';
import { buildHints, leaksTarget } from '../src/logic/hints.ts';
import { addDays } from '../src/logic/daily.ts';
import { routeHasMatch } from '../src/logic/puzzleQuality.ts';
import { parOf } from '../src/logic/par.ts';
import { loadCountries, loadPuzzles } from './lib.ts';

const data = loadCountries();
const puzzles = loadPuzzles();
const g = playableGraph(data);
const ctx = { countries: data.countries };
const errors: string[] = [];
const err = (p: { number: number }, msg: string) => errors.push(`#${p.number}: ${msg}`);
const lastTarget = new Map<string, number>();

puzzles.forEach((p, i) => {
  const s = data.countries[p.start], t = data.countries[p.target];
  if (p.number !== i + 1) err(p, `number should be ${i + 1}`);
  if (p.date !== addDays(LAUNCH_DATE, i)) err(p, `date ${p.date} should be ${addDays(LAUNCH_DATE, i)}`);
  if (!s) return err(p, `start ${p.start} does not exist`);
  if (!t) return err(p, `target ${p.target} does not exist`);
  if (!s.playable) err(p, `start ${s.name} is not playable`);
  if (!t.playable) err(p, `target ${t.name} is not playable`);
  if (p.start === p.target) err(p, 'start is the target');
  if (s.component !== t.component) err(p, `${s.name} and ${t.name} are in different components`);
  // Par = shortest path that avoids the giant countries (PAR_AVOIDS) when possible.
  const d = parOf(g, p.start, p.target);
  if (!(distance(g, p.start, p.target) < Infinity)) err(p, 'no path between start and target');
  if (d < MIN_PAR || d > MAX_PAR) err(p, `par (shortest path) ${d} outside ${MIN_PAR}..${MAX_PAR}`);
  if (d !== p.par) err(p, `stored par ${p.par} != computed par ${d}`);
  if (!t.landmark) err(p, `target ${t.name} has no landmark entry`);
  const hints = buildHints(t, d, ctx);
  if (hints.length !== d) err(p, `only ${hints.length} hints for par ${d} (not enough general hints for the middle slots)`);
  for (const h of hints) if (leaksTarget(h.text, t)) err(p, `hint leaks name/capital of ${t.name}: "${h.text}"`);
  if (REQUIRE_ROUTE_MATCH && d === p.par && !routeHasMatch(g, ctx, p.start, p.target, d)) err(p, 'no country on a shortest route matches any hint');
  const prev = lastTarget.get(p.target);
  if (prev !== undefined && i - prev < TARGET_REPEAT_DAYS) err(p, `target ${t.name} repeats after ${i - prev} days`);
  lastTarget.set(p.target, i);
});

// Every landmark, not only the ones used so far, must not leak its own country.
for (const c of Object.values(data.countries)) {
  if (c.playable && c.landmark && leaksTarget(c.landmark, c)) errors.push(`landmark for ${c.name} leaks its name/capital: "${c.landmark}"`);
  // Same for every bonus fun fact; and each playable country needs at least one.
  if (c.playable && !c.funFacts?.length) errors.push(`${c.name} has no fun facts`);
  for (const f of (c.playable && c.funFacts) || []) if (leaksTarget(f, c)) errors.push(`fun fact for ${c.name} leaks its name/capital: "${f}"`);
}

if (errors.length) {
  console.error(`puzzles.json: ${errors.length} problem(s)`);
  errors.forEach((e) => console.error(`  ${e}`));
  process.exit(1);
}
console.log(`puzzles.json OK: ${puzzles.length} puzzles valid`);
