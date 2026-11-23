// Generate public/data/puzzles.json: an easy, a medium and a hard puzzle for each of PUZZLE_DAYS days.
//   node scripts/generate-puzzles.ts
import fs from 'node:fs';
import path from 'node:path';
import {
  LAUNCH_DATE, PUZZLE_DAYS, PUZZLE_SEED, MIN_PAR, TARGET_REPEAT_DAYS, APPEARANCE_GAP_DAYS, REQUIRE_ROUTE_MATCH,
  PAR_AVOIDS, DAILY_DIFFICULTIES,
} from '../config/game.config.ts';
import { playableGraph, distance } from '../src/logic/graph.ts';
import { mulberry32 } from '../src/logic/rng.ts';
import { addDays } from '../src/logic/daily.ts';
import { eligibleTargets, pickPuzzle } from '../src/logic/puzzleGen.ts';
import { DAILY_ORDER, type Puzzle } from '../src/logic/types.ts';
import { loadCountries, OUT } from './lib.ts';

const data = loadCountries();
const g = playableGraph(data);
const ctx = { countries: data.countries };
const rand = mulberry32(PUZZLE_SEED);

const targets = eligibleTargets(g, ctx, MIN_PAR);
const skipped = [...g.keys()].filter((id) => !targets.includes(id));
if (skipped.length) console.warn(`not usable as targets (no landmark / leaking landmark / too few hints): ${skipped.join(', ')}`);

// Spread targets evenly: each puzzle draws from the least-used targets first (widening if none fit).
// No country shows up again, as start or target, within APPEARANCE_GAP_DAYS, and the three puzzles
// of one day never share a country.
const puzzles: Puzzle[] = [];
const lastTarget = new Map<string, number>();
const lastSeen = new Map<string, number>();
const uses = new Map<string, number>(targets.map((t) => [t, 0]));
const within = (m: Map<string, number>, day: number, gap: number) =>
  new Set([...m].filter(([, d]) => day - d < gap).map(([id]) => id));

for (let day = 0; day < PUZZLE_DAYS; day++) {
  const today = new Set<string>();
  // Hardest first: it has the fewest valid start/target pairs, so it gets first pick.
  const made = new Map<string, Puzzle>();
  for (const difficulty of [...DAILY_ORDER].reverse()) {
    const [minPar, maxPar] = DAILY_DIFFICULTIES[difficulty];
    const seen = new Set([...within(lastSeen, day, APPEARANCE_GAP_DAYS), ...today]);
    const avoidTargets = new Set([...within(lastTarget, day, TARGET_REPEAT_DAYS), ...seen]);
    const opts = { minPar, maxPar, requireRouteMatch: REQUIRE_ROUTE_MATCH, avoidTargets, avoidStarts: seen };
    const pool = targets.filter((t) => !avoidTargets.has(t));
    const tiers = [...new Set(pool.map((t) => uses.get(t)!))].sort((a, b) => a - b);
    let p = null;
    for (const max of tiers) {
      p = pickPuzzle(rand, g, ctx, pool.filter((t) => uses.get(t)! <= max), opts);
      if (p) break;
    }
    if (!p) throw new Error(`could not generate a ${difficulty} puzzle for day ${day + 1}`);
    for (const id of [p.start, p.target]) { lastSeen.set(id, day); today.add(id); }
    lastTarget.set(p.target, day);
    uses.set(p.target, uses.get(p.target)! + 1);
    made.set(difficulty, { number: day + 1, date: addDays(LAUNCH_DATE, day), difficulty, ...p });
  }
  for (const d of DAILY_ORDER) puzzles.push(made.get(d)!);
}

fs.writeFileSync(path.join(OUT, 'puzzles.json'), JSON.stringify({ launch: LAUNCH_DATE, puzzles }));
const shortcuts = puzzles.filter((p) => distance(g, p.start, p.target) < p.par).length;
const used = [...uses.values()];
console.log(`wrote ${puzzles.length} puzzles: ${PUZZLE_DAYS} days x 3 (${puzzles[0].date} .. ${puzzles.at(-1)!.date})`);
for (const d of DAILY_ORDER) {
  const pars = new Map<number, number>();
  puzzles.filter((p) => p.difficulty === d).forEach((p) => pars.set(p.par, (pars.get(p.par) ?? 0) + 1));
  console.log(`  ${d.padEnd(6)} par distribution: ${[...pars].sort((a, b) => a[0] - b[0]).map(([p, n]) => `${p}:${n}`).join('  ')}`);
}
console.log(`puzzles where a shortcut through ${PAR_AVOIDS.join('/')} beats par: ${shortcuts}`);
console.log(`distinct targets: ${used.filter((n) => n > 0).length}, each used ${Math.min(...used)}-${Math.max(...used)} times`);
