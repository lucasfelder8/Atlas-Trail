import {
  HINT_ORDER, REFERENCE_COUNTRIES, DEFAULT_STATUS, LATE_LANGUAGE_MAX_COUNTRIES, LATE_LANGUAGE_BEFORE,
} from '../../config/game.config.ts';
import type { Country, Facts } from './types.ts';

export type MiddleKind = (typeof HINT_ORDER)[number];
export type HintKind = 'continent' | MiddleKind | 'landmark';

export interface Hint {
  kind: HintKind;
  text: string;
  /** Kind-specific parameter the card evaluator needs (language, currency code, ref|bucket…). */
  param?: string;
}

/** One line on the info card: the selected country's own value for a revealed hint. */
export interface CardLine {
  kind: HintKind;
  label: string;
  value: string;
  /** null = free text, no check/cross (the landmark). */
  match: boolean | null;
}

export interface HintContext {
  countries: Record<string, Country>;
}

// ---------------------------------------------------------------- helpers

export const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Does this text mention the target's name or any of its capitals? */
export function leaksTarget(text: string, target: Country): boolean {
  const t = normalize(text);
  const words = [target.name, ...(target.facts?.capitals ?? [])].filter(Boolean);
  return words.some((w) => t.includes(normalize(w)));
}

export function continentLabel(f: Facts): string {
  const c = f.continents;
  if (c.includes('Europe') && c.includes('Asia')) return 'Eurasia';
  return c.join(' / ');
}

function continentMatch(a: Facts, b: Facts): boolean {
  return a.continents.some((c) => b.continents.includes(c));
}

const RATIO_BUCKETS: [number, string][] = [
  [0.1, 'less than a tenth of'],
  [0.5, 'a tenth to half of'],
  [1, 'half to the same as'],
  [2, 'one to two times'],
  [Infinity, 'more than twice'],
];
const bucketOf = (ratio: number) => RATIO_BUCKETS.findIndex(([max]) => ratio < max);
const possessive = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`);
const relText = (bucket: number, ref: string) =>
  `${RATIO_BUCKETS[bucket][1]} ${possessive(REFERENCE_COUNTRIES[ref])}`;

type Metric = 'population' | 'areaKm2';

/** Pick the reference country closest (log scale) to the target, never the target itself. */
function relativeHint(target: Country, ctx: HintContext, metric: Metric) {
  const v = target.facts![metric];
  let best: string | null = null;
  let bestD = Infinity;
  for (const ref of Object.keys(REFERENCE_COUNTRIES)) {
    const rf = ctx.countries[ref]?.facts;
    if (!rf || ref === target.id) continue;
    const d = Math.abs(Math.log(v / rf[metric]));
    if (d < bestD) { bestD = d; best = ref; }
  }
  if (!best) return null;
  const bucket = bucketOf(v / ctx.countries[best].facts![metric]);
  return { ref: best, bucket };
}

function relativeCard(c: Facts, param: string, ctx: HintContext, metric: Metric) {
  const [ref, b] = param.split('|');
  const bucket = bucketOf(c[metric] / ctx.countries[ref].facts![metric]);
  return { value: relText(bucket, ref), match: bucket === Number(b) };
}

const firstLetter = (s: string) => normalize(s).charAt(0).toUpperCase();
const countries = (n: number) => (n === 1 ? '1 country' : `${n} countries`);

let langCountCache: { ctx: HintContext; counts: Map<string, number> } | null = null;
function languagePopularity(ctx: HintContext): Map<string, number> {
  if (langCountCache?.ctx === ctx) return langCountCache.counts;
  const counts = new Map<string, number>();
  for (const c of Object.values(ctx.countries))
    if (c.playable && c.facts) for (const l of c.facts.languages) counts.set(l, (counts.get(l) ?? 0) + 1);
  langCountCache = { ctx, counts };
  return counts;
}

// ---------------------------------------------------------------- target hints

/** Build the hint for one middle kind, or null if it does not apply to this target. */
function middleHint(kind: MiddleKind, t: Country, ctx: HintContext): Hint | null {
  const f = t.facts!;
  const ok = (h: Hint | null) => (h && !leaksTarget(h.text, t) ? h : null);
  switch (kind) {
    case 'status':
      return f.status !== DEFAULT_STATUS ? ok({ kind, text: `Status: ${f.status}` }) : null;
    case 'subregion': {
      if (!f.subregion || f.continents.includes(f.subregion) || f.subregion === continentLabel(f)) return null;
      return ok({ kind, text: `Subregion: ${f.subregion}` });
    }
    case 'landlocked':
      return ok({ kind, text: `Landlocked: ${f.landlocked ? 'yes' : 'no'}` });
    case 'language': {
      // Prefer the most widely shared language (broad, recognizable), skipping any that leak the name.
      const pop = languagePopularity(ctx);
      const langs = [...f.languages].sort((a, b) => (pop.get(b) ?? 0) - (pop.get(a) ?? 0));
      for (const l of langs) {
        const h = ok({ kind, text: `Official language: ${l}`, param: l });
        if (h) return h;
      }
      return null;
    }
    case 'religion': {
      const r = t.religion;
      if (!r || r.basis === 'none') return null;
      const word = r.basis === 'official' ? 'Official' : 'Majority';
      return ok({ kind, text: `${word} religion: ${r.religion}`, param: r.religion });
    }
    case 'currency':
      for (const cur of f.currencies) {
        const h = ok({ kind, text: `Currency: ${cur.name}`, param: cur.code });
        if (h) return h;
      }
      return null;
    case 'driving':
      return ok({ kind, text: `Drives on the ${f.drivingSide}`, param: f.drivingSide });
    case 'population':
    case 'area': {
      const metric: Metric = kind === 'population' ? 'population' : 'areaKm2';
      const r = relativeHint(t, ctx, metric);
      if (!r) return null;
      const label = kind === 'population' ? 'Population' : 'Area';
      return ok({ kind, text: `${label}: ${relText(r.bucket, r.ref)}`, param: `${r.ref}|${r.bucket}` });
    }
    case 'borders':
      return ok({ kind, text: `Borders ${countries(f.borderCount)}`, param: String(f.borderCount) });
    case 'capitalLetter': {
      if (!f.capitals.length) return null;
      const l = firstLetter(f.capitals[0]);
      return ok({ kind, text: `Capital starts with “${l}”`, param: l });
    }
  }
}

/** A language that points straight at one or a few countries (see LATE_LANGUAGE_MAX_COUNTRIES). */
export function isGiveawayLanguage(lang: string, ctx: HintContext): boolean {
  return (languagePopularity(ctx).get(lang) ?? 0) <= LATE_LANGUAGE_MAX_COUNTRIES;
}

/**
 * All applicable middle hints for a target, in HINT_ORDER priority. A give-away language hint is
 * moved late, just before the LATE_LANGUAGE_BEFORE hint (or to the end if there is none).
 */
export function middleHints(target: Country, ctx: HintContext, order: readonly MiddleKind[] = HINT_ORDER): Hint[] {
  const out: Hint[] = [];
  let late: Hint | null = null;
  for (const k of order) {
    const h = middleHint(k, target, ctx);
    if (!h) continue;
    if (h.kind === 'language' && isGiveawayLanguage(h.param!, ctx)) late = h;
    else out.push(h);
  }
  if (late) {
    const i = out.findIndex((h) => h.kind === LATE_LANGUAGE_BEFORE);
    out.splice(i < 0 ? out.length : i, 0, late);
  }
  return out;
}

/**
 * Hints for a puzzle. Count = par: continent first, landmark last, middle facts in priority order.
 * Returns fewer than `par` hints only if the data cannot fill them (the validator rejects that).
 */
export function buildHints(target: Country, par: number, ctx: HintContext, order: readonly MiddleKind[] = HINT_ORDER): Hint[] {
  if (!target.facts || par < 1) return [];
  const landmark: Hint = { kind: 'landmark', text: target.landmark ?? '' };
  if (par === 1) return [landmark];
  const continent: Hint = { kind: 'continent', text: `Continent: ${continentLabel(target.facts)}` };
  return [continent, ...middleHints(target, ctx, order).slice(0, par - 2), landmark];
}

/** How many hints are visible: 1 at the start, +1 per valid guess, all once the game is over. */
export function revealedCount(par: number, guessCount: number, gameOver: boolean): number {
  return gameOver ? par : Math.min(par, 1 + guessCount);
}

// ---------------------------------------------------------------- hint helper

/** Hints that can be shown as a set of countries on the map (everything except the free-text landmark). */
export const canShowOnMap = (h: Hint) => h.kind !== 'landmark';

/**
 * Every playable country that fits a hint (the target included), for the "show on map" helper.
 * Uses the same rule as the info-card check marks, so the map and the cards always agree.
 */
export function countriesMatching(hint: Hint, target: Country, ctx: HintContext): string[] {
  if (!canShowOnMap(hint)) return [];
  return Object.values(ctx.countries)
    .filter((c) => c.playable && c.facts && evaluateHint(hint, target, c, ctx).match === true)
    .map((c) => c.id);
}

// ---------------------------------------------------------------- card evaluation

/** The selected country's value for a revealed hint, with match against the target. */
export function evaluateHint(hint: Hint, target: Country, c: Country, ctx: HintContext): CardLine {
  const f = c.facts;
  const tf = target.facts!;
  const line = (label: string, value: string, match: boolean | null): CardLine => ({ kind: hint.kind, label, value, match });
  if (hint.kind === 'landmark') return line('Landmark', hint.text, null);
  if (!f) return line(hint.kind, 'unknown', false);
  switch (hint.kind) {
    case 'continent':
      return line('Continent', continentLabel(f), continentMatch(f, tf));
    case 'status':
      return line('Status', f.status, f.status === tf.status);
    case 'subregion':
      return line('Subregion', f.subregion || 'none', f.subregion === tf.subregion);
    case 'landlocked':
      return line('Landlocked', f.landlocked ? 'yes' : 'no', f.landlocked === tf.landlocked);
    case 'language': {
      const has = f.languages.includes(hint.param!);
      return line('Language', has ? hint.param! : f.languages.slice(0, 2).join(', ') || 'none', has);
    }
    case 'religion': {
      const r = c.religion;
      if (!r) return line('Religion', 'unknown', false);
      if (r.basis === 'none') return line('Religion', 'no clear majority', false);
      return line('Religion', r.religion, r.religion === hint.param);
    }
    case 'currency': {
      const hit = f.currencies.find((x) => x.code === hint.param);
      return line('Currency', (hit ?? f.currencies[0])?.name ?? 'none', !!hit);
    }
    case 'driving':
      return line('Driving side', f.drivingSide, f.drivingSide === hint.param);
    case 'population':
      return { ...line('Population', '', false), ...relativeCard(f, hint.param!, ctx, 'population') };
    case 'area':
      return { ...line('Area', '', false), ...relativeCard(f, hint.param!, ctx, 'areaKm2') };
    case 'borders':
      return line('Borders', countries(f.borderCount), String(f.borderCount) === hint.param);
    case 'capitalLetter': {
      if (!f.capitals.length) return line('Capital starts with', 'no capital', false);
      const l = firstLetter(f.capitals[0]);
      return line('Capital starts with', l, l === hint.param);
    }
  }
}
