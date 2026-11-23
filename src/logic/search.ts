import type { Graph } from './graph.ts';
import { normalize } from './hints.ts';
import { isLegal } from './legality.ts';
import { DAILY_ORDER, type Country, type DailyDifficulty } from './types.ts';
import { DAILY_DIFFICULTIES } from '../../config/game.config.ts';

/** Other names people type. Keys are alpha-3 ids; matched like the official name. */
export const ALIASES: Record<string, string[]> = {
  COD: ['Democratic Republic of the Congo', 'Congo-Kinshasa', 'Zaire'],
  COG: ['Republic of the Congo', 'Congo-Brazzaville'],
  CIV: ["Côte d'Ivoire", 'Cote dIvoire'],
  CZE: ['Czech Republic'],
  SWZ: ['Swaziland'],
  MMR: ['Burma'],
  ARE: ['UAE', 'Emirates'],
  USA: ['USA', 'United States of America', 'America', 'US'],
  NLD: ['Holland'],
  MKD: ['Macedonia'],
  VAT: ['Holy See', 'Vatican'],
  KOR: ['Korea', 'Republic of Korea'],
  PRK: ['DPRK'],
  TUR: ['Türkiye', 'Turkiye'],
  CAF: ['CAR'],
  BIH: ['Bosnia'],
  UNK: ['Republic of Kosovo'],
  PSE: ['West Bank', 'State of Palestine'],
  ESH: ['Sahrawi Republic'],
  LAO: ["Lao People's Democratic Republic"],
  GMB: ['The Gambia'],
};

export interface SearchHit {
  id: string;
  name: string;
  /** True when the country can be tapped right now (visited, or next to the visited region). */
  legal: boolean;
}

/**
 * Playable countries whose name (or an alias) matches what was typed, best first:
 * name prefix, then a word in the name, then aliases; legal ones before others within a rank.
 */
export function searchCountries(
  query: string, countries: Record<string, Country>, g: Graph, visited: ReadonlySet<string>, limit = 6,
): SearchHit[] {
  const q = normalize(query.trim());
  if (!q) return [];
  const rank = (c: Country): number => {
    const names = [c.name, ...(ALIASES[c.id] ?? [])].map(normalize);
    if (names[0].startsWith(q)) return 0;
    if (names[0].split(/[\s-]+/).some((w) => w.startsWith(q))) return 1;
    if (names.slice(1).some((n) => n.startsWith(q) || n.split(/[\s-]+/).some((w) => w.startsWith(q)))) return 2;
    return -1;
  };
  return Object.values(countries)
    .filter((c) => c.playable && g.has(c.id))
    .map((c) => ({ c, r: rank(c), l: isLegal(g, visited, c.id) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || Number(b.l) - Number(a.l) || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map(({ c, l }) => ({ id: c.id, name: c.name, legal: l }));
}

export type DifficultyLabel = 'Easy' | 'Medium' | 'Hard';
export const LABEL: Record<DailyDifficulty, DifficultyLabel> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
/** The DAILY_DIFFICULTIES band a par falls in (easy 3–4, medium 5–6, hard 7–8 by default). */
export const difficultyOf = (par: number): DifficultyLabel =>
  LABEL[DAILY_ORDER.find((d) => par <= DAILY_DIFFICULTIES[d][1]) ?? 'hard'];
