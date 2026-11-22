// Generate public/data/puzzles.json for PUZZLE_DAYS days from LAUNCH_DATE.
//   node scripts/generate-puzzles.ts
import fs from 'node:fs';
import path from 'node:path';
import {
  LAUNCH_DATE, PUZZLE_DAYS, PUZZLE_SEED, MIN_PAR, MAX_PAR, TARGET_REPEAT_DAYS, REQUIRE_ROUTE_MATCH, PAR_AVOIDS,
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

const puzzles: Puzzle[] = [];
const lastUsed = new Map<string, number>();
for (let day = 0; day < PUZZLE_DAYS; day++) {
  const recent = new Set([...lastUsed].filter(([, d]) => day - d < TARGET_REPEAT_DAYS).map(([t]) => t));
  const p = pickPuzzle(rand, g, ctx, targets, { minPar: MIN_PAR, maxPar: MAX_PAR, requireRouteMatch: REQUIRE_ROUTE_MATCH, avoidTargets: recent });
  if (!p) throw new Error(`could not generate a puzzle for day ${day + 1}`);
  lastUsed.set(p.target, day);
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
