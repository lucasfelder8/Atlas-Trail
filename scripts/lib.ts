import fs from 'node:fs';
import path from 'node:path';
import type { CountryData, Puzzle } from '../src/logic/types.ts';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const OUT = path.join(ROOT, 'public', 'data');

export function loadCountries(): CountryData {
  const p = path.join(OUT, 'countries.json');
  if (!fs.existsSync(p)) throw new Error('public/data/countries.json missing: run `npm run build:data` first');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function loadPuzzles(): Puzzle[] {
  return JSON.parse(fs.readFileSync(path.join(OUT, 'puzzles.json'), 'utf8')).puzzles;
}
