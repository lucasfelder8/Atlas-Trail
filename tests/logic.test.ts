import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { playableGraph, distance, shortestPath, type Graph } from '../src/logic/graph.ts';
import { isLegal, tap, targetIsAdjacent, visitedSet, TOAST_ILLEGAL, TOAST_EXCLUDED } from '../src/logic/legality.ts';
import { buildHints, evaluateHint, revealedCount, leaksTarget, countriesMatching, canShowOnMap, type Hint } from '../src/logic/hints.ts';
import { cardFor } from '../src/logic/infoCard.ts';
import { shareSquares, shareText, par } from '../src/logic/scoring.ts';
import { laDate, puzzleNumber, msUntilNextPuzzle, addDays } from '../src/logic/daily.ts';
import { applyGuess, emptyStats, giveUp, useHelper, helperCount, newGame, recordResult, displayStreak, averageGuesses, winRate } from '../src/logic/state.ts';
import type { Country, CountryData, Facts, Puzzle } from '../src/logic/types.ts';
import { GAME_NAME } from '../config/game.config.ts';

// ---------------------------------------------------------------- fixtures

const facts = (o: Partial<Facts> = {}): Facts => ({
  continents: ['Europe'], subregion: 'Western Europe', landlocked: false, languages: ['German'],
  currencies: [{ code: 'EUR', name: 'Euro' }], drivingSide: 'right', population: 1e6, areaKm2: 1e5,
  borderCount: 2, capitals: ['Cap'], status: 'Sovereign state', ...o,
});
const country = (id: string, neighbors: string[], o: Partial<Country> = {}): Country => ({
  id, name: `Name-${id}`, playable: true, component: 0, neighbors, label: [0, 0], tiny: false,
  facts: facts(), religion: { religion: 'Christianity', basis: 'majority' }, landmark: `Landmark ${id}`, ...o,
});

// A - B - C - D - E (line), plus X (not playable) next to A.
function lineData(): CountryData {
  const c: Record<string, Country> = {
    A: country('A', ['B', 'X']), B: country('B', ['A', 'C']), C: country('C', ['B', 'D']),
    D: country('D', ['C', 'E']), E: country('E', ['D']),
    X: country('X', ['A'], { playable: false, component: -1 }),
  };
  return { countries: c };
}

// Germany-centred toy map for the "borders ANY visited country" rule.
function europe(): Graph {
  const adj: Record<string, string[]> = {
    DEU: ['POL', 'FRA'], POL: ['DEU', 'UKR'], UKR: ['POL', 'RUS'], RUS: ['UKR'], FRA: ['DEU', 'ESP'], ESP: ['FRA'],
  };
  return new Map(Object.entries(adj));
}

const real = (): CountryData => JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../public/data/countries.json'), 'utf8'));
const realPuzzles = (): Puzzle[] => JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../public/data/puzzles.json'), 'utf8')).puzzles;

// ---------------------------------------------------------------- graph

test('graph excludes non-playable countries and finds shortest paths', () => {
  const g = playableGraph(lineData());
  assert.equal(g.has('X'), false);
  assert.deepEqual(g.get('A'), ['B']);
  assert.equal(distance(g, 'A', 'E'), 4);
  assert.deepEqual(shortestPath(g, 'A', 'E'), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(shortestPath(g, 'A', 'E', new Set(['A', 'B', 'E'])), null);
});

// ---------------------------------------------------------------- legality

test('legal = visited or borders ANY visited country, not just the latest guess', () => {
  const g = europe();
  const visited = visitedSet('DEU', ['POL', 'UKR', 'RUS']);
  assert.equal(isLegal(g, visited, 'FRA'), true, 'France borders Germany (the start)');
  assert.equal(isLegal(g, visited, 'ESP'), false, 'Spain borders nothing visited');
  assert.equal(isLegal(g, visited, 'DEU'), true, 'visited countries are legal');
});

test('target alert fires when the target borders any visited country', () => {
  const g = europe();
  assert.equal(targetIsAdjacent(g, visitedSet('DEU', []), 'ESP'), false);
  assert.equal(targetIsAdjacent(g, visitedSet('DEU', ['POL', 'FRA']), 'ESP'), true);
});

test('illegal and excluded taps produce only a toast: no id, no name, no card', () => {
  const data = lineData();
  const g = playableGraph(data);
  const visited = visitedSet('A', []);
  const ctx = { countries: data.countries };
  const target = data.countries.E;
  const hints = buildHints(target, 4, ctx);

  const illegal = tap(g, visited, 'D', false);
  assert.deepEqual(illegal, { kind: 'toast', message: TOAST_ILLEGAL });
  assert.equal(JSON.stringify(illegal).includes('Name-D'), false);
  assert.equal(cardFor(g, visited, 'D', target, hints, ctx, false), null);

  const excluded = tap(g, visited, 'X', false);
  assert.deepEqual(excluded, { kind: 'toast', message: TOAST_EXCLUDED });
  assert.equal(cardFor(g, visited, 'X', target, hints, ctx, false), null);

  const legal = cardFor(g, visited, 'B', target, hints, ctx, false)!;
  assert.equal(legal.name, 'Name-B');
  assert.equal(legal.showGuessButton, true);
  assert.equal(cardFor(g, visited, 'A', target, hints, ctx, false)!.showGuessButton, false, 'visited: no Guess button');
});

test('illegal countries never produce a card on the real map', () => {
  const data = real();
  const g = playableGraph(data);
  const ctx = { countries: data.countries };
  for (const p of realPuzzles().slice(0, 30)) {
    const visited = visitedSet(p.start, []);
    const hints = buildHints(data.countries[p.target], p.par, ctx);
    for (const id of Object.keys(data.countries)) {
      const card = cardFor(g, visited, id, data.countries[p.target], hints, ctx, false);
      if (!isLegal(g, visited, id)) assert.equal(card, null, `${id} is illegal but produced a card`);
    }
  }
});

// ---------------------------------------------------------------- hints

test('hint count equals par for every generated puzzle; continent first, landmark last; no leaks', () => {
  const data = real();
  const ctx = { countries: data.countries };
  for (const p of realPuzzles()) {
    const t = data.countries[p.target];
    const hints = buildHints(t, p.par, ctx);
    assert.equal(hints.length, p.par, `puzzle #${p.number}`);
    assert.equal(hints[0].kind, 'continent');
    assert.equal(hints.at(-1)!.kind, 'landmark');
    assert.equal(hints.at(-1)!.text, t.landmark);
    for (const h of hints) assert.equal(leaksTarget(h.text, t), false, h.text);
  }
});

test('hint count equals par for every possible par on toy data', () => {
  const data = lineData();
  for (let p = 2; p <= 8; p++) assert.equal(buildHints(data.countries.E, p, { countries: data.countries }).length, p);
});

test('revealed hints: 1 at start, +1 per guess, capped at par, all when finished', () => {
  assert.equal(revealedCount(5, 0, false), 1);
  assert.equal(revealedCount(5, 2, false), 3);
  assert.equal(revealedCount(5, 9, false), 5);
  assert.equal(revealedCount(5, 0, true), 5);
});

test('religion hint wording and skip when basis is none', () => {
  const data = lineData();
  const ctx = { countries: data.countries };
  data.countries.E.religion = { religion: 'Islam', basis: 'official' };
  assert.ok(buildHints(data.countries.E, 8, ctx).some((h) => h.text === 'Official religion: Islam'));
  data.countries.E.religion = { religion: 'Islam', basis: 'majority' };
  assert.ok(buildHints(data.countries.E, 8, ctx).some((h) => h.text === 'Majority religion: Islam'));
  data.countries.E.religion = { religion: 'Islam', basis: 'none' };
  assert.ok(!buildHints(data.countries.E, 8, ctx).some((h) => h.kind === 'religion'));
});

test('card: religion matches regardless of basis; basis none shows "no clear majority" ✗', () => {
  const data = lineData();
  const ctx = { countries: data.countries };
  const t = data.countries.E;
  t.religion = { religion: 'Christianity', basis: 'official' };
  const h: Hint = { kind: 'religion', text: 'Official religion: Christianity', param: 'Christianity' };
  data.countries.B.religion = { religion: 'Christianity', basis: 'majority' };
  assert.equal(evaluateHint(h, t, data.countries.B, ctx).match, true);
  data.countries.B.religion = { religion: 'Christianity', basis: 'none' };
  assert.deepEqual(
    { v: evaluateHint(h, t, data.countries.B, ctx).value, m: evaluateHint(h, t, data.countries.B, ctx).match },
    { v: 'no clear majority', m: false },
  );
});

test('card: landmark has no check/cross; continent matches across Eurasia', () => {
  const data = lineData();
  const ctx = { countries: data.countries };
  const t = data.countries.E;
  const lm = evaluateHint({ kind: 'landmark', text: 'x' }, t, data.countries.B, ctx);
  assert.equal(lm.match, null);
  data.countries.B.facts!.continents = ['Europe', 'Asia'];
  const line = evaluateHint({ kind: 'continent', text: 'Continent: Europe' }, t, data.countries.B, ctx);
  assert.deepEqual([line.value, line.match], ['Eurasia', true]);
});

test('status hint only appears for non-sovereign / disputed targets', () => {
  const data = lineData();
  const ctx = { countries: data.countries };
  assert.ok(!buildHints(data.countries.E, 8, ctx).some((h) => h.kind === 'status'));
  data.countries.E.facts!.status = 'Partially recognized state';
  assert.equal(buildHints(data.countries.E, 8, ctx)[1].text, 'Status: Partially recognized state');
});

test('hints that would contain the target name are skipped', () => {
  const data = lineData();
  const ctx = { countries: data.countries };
  data.countries.E.name = 'Mongolia';
  data.countries.E.facts!.languages = ['Mongolian'];
  assert.ok(!buildHints(data.countries.E, 8, ctx).some((h) => h.kind === 'language'));
});

test('fun facts: one per wrong guess after par, cycled, rotated per puzzle, never leaking', async () => {
  const { funFactsUnlocked, funFactOrder, funFactAt } = await import('../src/logic/hints.ts');
  // par 4: hints are full after 3 guesses; the 4th, 5th... wrong guess unlock facts.
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((k) => funFactsUnlocked(4, k)), [0, 0, 0, 0, 1, 2, 3]);
  const t = country('T', [], { funFacts: ['a', 'b', 'c'] });
  assert.deepEqual(funFactOrder(t, 0), ['a', 'b', 'c']);
  assert.deepEqual(funFactOrder(t, 4), ['b', 'c', 'a'], 'rotated by puzzle number');
  const order = funFactOrder(t, 0);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => funFactAt(order, i)), ['a', 'b', 'c', 'a', 'b'], 'wraps around');
  assert.equal(funFactAt(funFactOrder(country('U', []), 1), 0), null, 'no facts: nothing to show');
  for (const c of Object.values(real().countries)) {
    if (!c.playable) continue;
    assert.ok(c.funFacts?.length, `${c.name} has fun facts`);
    for (const f of c.funFacts!) assert.ok(!leaksTarget(f, c), `${c.name}: "${f}" leaks the name or capital`);
  }
});

test('search: prefix first, aliases, accents ignored, legal before far, playable only', async () => {
  const { searchCountries, difficultyOf } = await import('../src/logic/search.ts');
  const data = real();
  const g = playableGraph(data);
  const names = (q: string, vis = new Set(['DEU'])) => searchCountries(q, data.countries, g, vis).map((h) => h.name);
  assert.equal(names('ger')[0], 'Germany');
  assert.ok(names('ivory').includes('Ivory Coast'));
  assert.ok(names('cote').includes('Ivory Coast'), 'alias, accent-insensitive');
  assert.ok(names('czech').includes('Czechia'), 'alias');
  assert.ok(!names('jap').includes('Japan'), 'non-playable countries never show');
  assert.deepEqual(names(''), []);
  // From Germany, Poland is legal and Portugal is not: Poland ranks first among "Po..." names.
  const po = searchCountries('po', data.countries, g, new Set(['DEU']));
  assert.equal(po[0].name, 'Poland');
  assert.ok(po[0].legal && !po.find((h) => h.name === 'Portugal')!.legal);
  assert.deepEqual([3, 4, 5, 6, 7, 8].map(difficultyOf), ['Easy', 'Easy', 'Medium', 'Medium', 'Hard', 'Hard']);
});

test('three daily puzzles: easy/medium/hard each day, par in band, no shared countries that day', async () => {
  const { DAILY_DIFFICULTIES } = await import('../config/game.config.ts');
  const ps = realPuzzles();
  assert.equal(ps.length % 3, 0);
  for (let i = 0; i < ps.length; i += 3) {
    const day = ps.slice(i, i + 3);
    assert.deepEqual(day.map((p) => p.difficulty), ['easy', 'medium', 'hard'], `day ${day[0].number}`);
    assert.ok(day.every((p) => p.number === day[0].number && p.date === day[0].date));
    for (const p of day) {
      const [lo, hi] = DAILY_DIFFICULTIES[p.difficulty];
      assert.ok(p.par >= lo && p.par <= hi, `#${p.number} ${p.difficulty} par ${p.par}`);
    }
    const ids = day.flatMap((p) => [p.start, p.target]);
    assert.equal(new Set(ids).size, ids.length, `day ${day[0].number} shares a country`);
  }
  assert.equal(shareText(4, 5, 7, ['🟩'], 0, 'Hard').split('\n')[0], `${GAME_NAME} #4 Hard - 5 guesses (par 7)`);
});

test('explore rows list every hint fact for a country', async () => {
  const { exploreRows } = await import('../src/explore.ts');
  const data = real();
  const rows = exploreRows(data.countries.CHE, data);
  const get = (label: string) => rows.find(([, k]) => k.startsWith(label))?.[2] ?? '';
  assert.equal(get('Landlocked'), 'Yes');
  assert.ok(get('Language').includes('German'));
  assert.ok(get('Borders').includes('Italy'));
  assert.ok(get('Capital').length > 0);
  assert.ok(rows.some(([, k]) => k === 'Religion'));
  assert.ok(exploreRows(data.countries.JPN, data).length > 5, 'countries not in play still have facts');
});

test('give-away languages (Korean, Chinese, Thai) come late; shared ones (German) stay early', () => {
  const data = real();
  const ctx = { countries: data.countries };
  const kinds = (id: string) => buildHints(data.countries[id], 8, ctx).map((h) => h.kind);
  assert.ok(!kinds('RUS').includes('language'), '"Russian" names Russia, so it is never a hint for Russia');
  for (const id of ['KOR', 'CHN', 'THA']) {
    const k = kinds(id);
    assert.ok(k.includes('language'), `${id} still gets a language hint at par 8`);
    assert.ok(k.indexOf('language') > k.indexOf('driving'), `${id}: language after driving`);
  }
  assert.equal(kinds('DEU')[1], 'language', 'German is shared by several countries, so it stays second');
});

// ---------------------------------------------------------------- scoring / share

test('share squares: green on a shortest route, yellow for detours, last always green', () => {
  const g = europe();
  // DEU -> ESP: shortest DEU-FRA-ESP (par 2)
  assert.equal(par(g, 'DEU', 'ESP'), 2);
  const sq = shareSquares(g, 'DEU', 'ESP', ['POL', 'FRA', 'ESP']);
  assert.deepEqual(sq, ['🟨', '🟩', '🟩']);
  assert.equal(shareText(7, 3, 2, sq).split('\n').slice(0, 2).join('\n'), `${GAME_NAME} #7 - 3 guesses (par 2)\n🟨🟩🟩`);
});

test('share text appends a lightbulb only when the helper was used', () => {
  const sq = ['🟩', '🟨', '🟩'];
  assert.equal(shareText(7, 3, 3, sq).split('\n')[1], '🟩🟨🟩');
  assert.equal(shareText(7, 3, 3, sq, 1).split('\n')[1], '🟩🟨🟩 💡');
  assert.equal(shareText(7, 3, 3, sq, 3).split('\n')[1], '🟩🟨🟩 💡💡💡');
});

test('each distinct hint looked up costs one lightbulb; repeats are free; finished games cannot be marked', () => {
  const g0 = newGame(5, 'A', 'B');
  assert.equal(helperCount(g0), 0);
  const g1 = useHelper(useHelper(g0, 1), 1);
  assert.equal(helperCount(g1), 1, 'same hint twice = one bulb');
  const g2 = useHelper(g1, 2);
  assert.equal(helperCount(g2), 2);
  assert.equal(helperCount(useHelper(giveUp(g0), 1)), 0);
  const won = applyGuess(g2, 'B');
  assert.equal(recordResult(emptyStats(), won, 1).results[5].helpers, 2);
  assert.equal(recordResult(emptyStats(), applyGuess(g0, 'B'), 1).results[5].helpers, undefined);
});

test('countriesMatching agrees with the card check marks and includes the target', () => {
  const data = real();
  const ctx = { countries: data.countries };
  const t = data.countries.EGY;
  const hints = buildHints(t, 4, ctx);
  assert.ok(!canShowOnMap(hints[hints.length - 1]), 'the landmark has no map set');
  assert.deepEqual(countriesMatching(hints[hints.length - 1], t, ctx), []);
  for (const h of hints.filter(canShowOnMap)) {
    const ids = countriesMatching(h, t, ctx);
    assert.ok(ids.includes(t.id), `${h.text}: target must fit its own hint`);
    for (const id of ids) assert.ok(data.countries[id].playable);
    for (const c of Object.values(data.countries).filter((x) => x.playable && x.facts))
      assert.equal(ids.includes(c.id), evaluateHint(h, t, c, ctx).match === true, `${h.text} / ${c.name}`);
  }
  const arabic = countriesMatching({ kind: 'language', text: 'Official language: Arabic', param: 'Arabic' }, t, ctx);
  assert.ok(arabic.includes('SAU') && arabic.includes('MAR') && !arabic.includes('FRA'));
});

// ---------------------------------------------------------------- daily

test('daily puzzle uses the Los Angeles date', () => {
  // 2026-11-22 06:00 UTC = 2026-11-21 22:00 in LA (PST, UTC-8)
  assert.equal(laDate(new Date('2026-11-22T06:00:00Z')), '2026-11-21');
  assert.equal(laDate(new Date('2026-11-22T08:30:00Z')), '2026-11-22');
  assert.equal(puzzleNumber('2026-11-21', '2026-11-21'), 1);
  assert.equal(puzzleNumber(addDays('2026-11-21', 10), '2026-11-21'), 11);
  assert.equal(msUntilNextPuzzle(new Date('2026-11-22T07:00:00Z')), 3_600_000);
  // DST: 2027-03-14 LA springs forward; midnight Mar 15 PDT = 07:00 UTC
  assert.equal(msUntilNextPuzzle(new Date('2027-03-15T06:00:00Z')), 3_600_000);
});

// ---------------------------------------------------------------- state / stats

test('guesses are permanent and winning ends the game', () => {
  let s = newGame(1, 'A', 'C');
  s = applyGuess(s, 'B');
  s = applyGuess(s, 'B');
  assert.deepEqual(s.guesses, ['B']);
  s = applyGuess(s, 'C');
  assert.equal(s.status, 'won');
  assert.deepEqual(applyGuess(s, 'D').guesses, ['B', 'C'], 'locked after win');
});

test('stats: streaks, give-up breaks streak, averages, idempotent', () => {
  let st = emptyStats();
  const win = (n: number, k: number) => ({ ...newGame(n, 'A', 'Z'), guesses: Array(k).fill('x'), status: 'won' as const });
  st = recordResult(st, win(1, 4), 3);
  st = recordResult(st, win(2, 6), 4);
  st = recordResult(st, win(2, 6), 4);
  assert.equal(st.played, 2);
  assert.equal(st.currentStreak, 2);
  assert.equal(averageGuesses(st), 5);
  assert.deepEqual(st.distribution, { 4: 1, 6: 1 });
  st = recordResult(st, giveUp(newGame(3, 'A', 'Z')), 5);
  assert.equal(st.currentStreak, 0);
  assert.equal(st.maxStreak, 2);
  assert.equal(winRate(st), 67);
  st = recordResult(st, win(5, 3), 3);
  assert.equal(st.currentStreak, 1, 'missed day 4 restarts the streak');
  assert.equal(displayStreak(st, 7), 0, 'not playing day 6 breaks the displayed streak');
});

// ---------------------------------------------------------------- card correctness (regressions)

test('the target itself matches every revealed hint, for every puzzle', () => {
  const data = real();
  const ctx = { countries: data.countries };
  for (const p of realPuzzles()) {
    const t = data.countries[p.target];
    for (const h of buildHints(t, p.par, ctx)) {
      const line = evaluateHint(h, t, t, ctx);
      assert.notEqual(line.match, false, `#${p.number} ${t.name}: "${h.text}" -> ${line.value}`);
    }
  }
});

test('card rows show the destination value and a match summary', () => {
  const data = real();
  const g = playableGraph(data);
  const ctx = { countries: data.countries };
  const t = data.countries.PAN;
  const hints = buildHints(t, 3, ctx);
  const card = cardFor(g, visitedSet('COL', []), 'COL', t, hints, ctx, false)!;
  const continent = card.rows.find((r) => r.kind === 'continent')!;
  assert.deepEqual([continent.value, continent.match, continent.targetValue], ['South America', false, 'North America']);
  assert.equal(card.rows.find((r) => r.kind === 'landmark')!.targetValue, null);
  assert.equal(card.checkable, 2);
  assert.equal(card.matches, 1, 'Colombia shares the language hint (Spanish)');
});

test('every generated puzzle has some country on a shortest route matching a hint', async () => {
  const { routeHasMatch } = await import('../src/logic/puzzleQuality.ts');
  const data = real();
  const g = playableGraph(data);
  const ctx = { countries: data.countries };
  for (const p of realPuzzles()) assert.ok(routeHasMatch(g, ctx, p.start, p.target, p.par), `#${p.number}`);
});

// ---------------------------------------------------------------- par avoids giant countries

test('par ignores shortcuts through giant countries unless there is no way around', async () => {
  const { parOf, parGraph } = await import('../src/logic/par.ts');
  // A - G - B shortcut through giant G, and a long way A - X - Y - B. M only borders G.
  const g: Graph = new Map(Object.entries({
    A: ['G', 'X'], G: ['A', 'B', 'M'], B: ['G', 'Y'], X: ['A', 'Y'], Y: ['X', 'B'], M: ['G'],
  }));
  assert.equal(distance(g, 'A', 'B'), 2);
  assert.equal(parOf(g, 'A', 'B', ['G']), 3, 'par uses the route around the giant');
  assert.equal(parOf(g, 'A', 'M', ['G']), 2, 'no way around: fall back to the full graph');
  assert.equal(parOf(g, 'G', 'B', ['G']), 1, 'the giant may be the start');
  assert.equal(parGraph(g, 'A', 'M', ['G']), g);
  // Sharing: both the par route and the shortcut route are green
  assert.deepEqual(shareSquares(g, 'A', 'B', ['X', 'Y', 'B'], ['G']).join(''), '🟩🟩🟩');
});

test('real puzzles: par equals the giant-avoiding distance and hint count equals par', async () => {
  const { parOf } = await import('../src/logic/par.ts');
  const data = real();
  const g = playableGraph(data);
  for (const p of realPuzzles()) {
    assert.equal(p.par, parOf(g, p.start, p.target), `#${p.number}`);
    assert.ok(distance(g, p.start, p.target) <= p.par);
  }
});

// ---------------------------------------------------------------- shading and practice

test('matchLevel: 0 when nothing matches, 4 when every checkable hint matches', async () => {
  const { matchLevel } = await import('../src/logic/infoCard.ts');
  const data = real();
  const ctx = { countries: data.countries };
  const t = data.countries.PAN;
  const hints = buildHints(t, 3, ctx).slice(0, 2);
  assert.equal(matchLevel(t, t, hints, ctx), 4);
  assert.equal(matchLevel(data.countries.DEU, t, hints, ctx), 0);
});

test('practice puzzles respect each difficulty range and all rules', async () => {
  const { pickPuzzle, eligibleTargets } = await import('../src/logic/puzzleGen.ts');
  const { routeHasMatch } = await import('../src/logic/puzzleQuality.ts');
  const { mulberry32 } = await import('../src/logic/rng.ts');
  const data = real();
  const g = playableGraph(data);
  const ctx = { countries: data.countries };
  const rand = mulberry32(7);
  for (const [minPar, maxPar] of [[3, 4], [5, 6], [7, 8]]) {
    for (let i = 0; i < 5; i++) {
      const p = pickPuzzle(rand, g, ctx, eligibleTargets(g, ctx, minPar), { minPar, maxPar, requireRouteMatch: true })!;
      assert.ok(p.par >= minPar && p.par <= maxPar, `par ${p.par}`);
      assert.notEqual(p.start, p.target);
      assert.equal(buildHints(data.countries[p.target], p.par, ctx).length, p.par);
      assert.ok(routeHasMatch(g, ctx, p.start, p.target, p.par));
    }
  }
});
