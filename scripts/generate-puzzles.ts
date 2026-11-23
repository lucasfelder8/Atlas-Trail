// Generate public/data/puzzles.json for PUZZLE_DAYS days from LAUNCH_DATE.
//   node scripts/generate-puzzles.ts
import fs from 'node:fs';
import path from 'node:path';
import {
  LAUNCH_DATE, PUZZLE_DAYS, PUZZLE_SEED, MIN_PAR, MAX_PAR, TARGET_REPEAT_DAYS, APPEARANCE_GAP_DAYS, REQUIRE_ROUTE_MATCH, PAR_AVOIDS,
} from '../config/game.config.ts';
import { playableGraph, distance } from '../src/logic/graph.ts';
import { mulberry32 } from '../src/logic/rng.ts';
import { addDays } from '../src/logic/daily.ts';
import { eligibleTargets, pickPuzzle } from '../src/logic/puzzleGen.ts';
import type { Puzzle } from '../src/logic/types.ts';
import { loadCountries, OUT } from './lib.ts';

const data = loadCountries();
const g = playableGraph(data);
const ctx = { countries: data.countries };
const rand = mulberry32(PUZZLE_SEED);

const targets = eligibleTargets(g, ctx, MIN_PAR);
const skipped = [...g.keys()].filter((id) => !targets.includes(id));
if (skipped.length) console.warn(`not usable as targets (no landmark / leaking landmark / too few hints): ${skipped.join(', ')}`);

// Spread targets evenly: each day draws from the least-used targets first (widening if none fit),
// and no country shows up again, as start or target, within APPEARANCE_GAP_DAYS.
const puzzles: Puzzle[] = [];
const lastTarget = new Map<string, number>();
const lastSeen = new Map<string, number>();
const uses = new Map<string, number>(targets.map((t) => [t, 0]));
const within = (m: Map<string, number>, day: number, gap: number) =>
  new Set([...m].filter(([, d]) => day - d < gap).map(([id]) => id));
for (let day = 0; day < PUZZLE_DAYS; day++) {
  const seen = within(lastSeen, day, APPEARANCE_GAP_DAYS);
  const avoidTargets = new Set([...within(lastTarget, day, TARGET_REPEAT_DAYS), ...seen]);
  const opts = { minPar: MIN_PAR, maxPar: MAX_PAR, requireRouteMatch: REQUIRE_ROUTE_MATCH, avoidTargets, avoidStarts: seen };
  const tiers = [...new Set(targets.filter((t) => !avoidTargets.has(t)).map((t) => uses.get(t)!))].sort((a, b) => a - b);
  let p = null;
  for (const max of tiers) {
    p = pickPuzzle(rand, g, ctx, targets.filter((t) => !avoidTargets.has(t) && uses.get(t)! <= max), opts);
    if (p) break;
  }
  p ??= pickPuzzle(rand, g, ctx, targets, { ...opts, avoidStarts: undefined }); // last resort: allow recent starts
  if (!p) throw new Error(`could not generate a puzzle for day ${day + 1}`);
  lastTarget.set(p.target, day);
  lastSeen.set(p.target, day);
  lastSeen.set(p.start, day);
  uses.set(p.target, uses.get(p.target)! + 1);
  puzzles.push({ number: day + 1, date: addDays(LAUNCH_DATE, day), ...p });
}

fs.writeFileSync(path.join(OUT, 'puzzles.json'), JSON.stringify({ launch: LAUNCH_DATE, puzzles }));
const pars = new Map<number, number>();
puzzles.forEach((p) => pars.set(p.par, (pars.get(p.par) ?? 0) + 1));
const shortcuts = puzzles.filter((p) => distance(g, p.start, p.target) < p.par).length;
console.log(`wrote ${puzzles.length} puzzles (${puzzles[0].date} .. ${puzzles.at(-1)!.date})`);
console.log(`par distribution: ${[...pars].sort((a, b) => a[0] - b[0]).map(([p, n]) => `${p}:${n}`).join('  ')}`);
console.log(`puzzles where a shortcut through ${PAR_AVOIDS.join('/')} beats par: ${shortcuts}`);
console.log(`distinct targets: ${new Set(puzzles.map((p) => p.target)).size}`);
