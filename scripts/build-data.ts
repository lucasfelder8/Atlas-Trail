// Build runtime data from the raw files in /data.
//   node scripts/build-data.ts
// Writes public/data/world.topo.json (simplified shapes) and public/data/countries.json,
// and prints: paging check, join report, overseas report, geometry-vs-REST adjacency report,
// playable-pool report and the tiny-polygon check. Exits nonzero on hard failures.
import fs from 'node:fs';
import path from 'node:path';
import { topology } from 'topojson-server';
import { presimplify, quantile, simplify } from 'topojson-simplify';
import { feature, quantize } from 'topojson-client';
import { geoArea } from 'd3-geo';
import {
  EXCLUDED, MIN_COMPONENT, MANUAL_ADJACENCY, OVERSEAS_SPLIT, OVERSEAS_KM,
  TOUCH_TOL_DEG, MIN_SHARED_PTS, TINY_AREA_KM2, STATUS, DEFAULT_STATUS,
} from '../config/game.config.ts';
import type { Country, Facts, Religion } from '../src/logic/types.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'public', 'data');
const SIMPLIFY_KEEP = 0.12; // fraction of non-endpoint vertices kept
let failures = 0;
const fail = (msg: string) => { console.error(`ERROR: ${msg}`); failures++; };

// ------------------------------------------------------------------ REST
type Rest = any;
const pages = fs.readdirSync(DATA).filter((f) => /^rc_\d+\.json$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
let rest: Rest[] = [];
let metaTotal = 0;
for (const f of pages) {
  const j = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
  rest = rest.concat(j.data.objects);
  metaTotal = j.data.meta.total;
}
console.log(`\n=== REST Countries: ${pages.join(', ')} ===`);
console.log(`records: ${rest.length}, meta.total: ${metaTotal}`);
if (rest.length !== metaTotal) fail(`record count ${rest.length} != meta.total ${metaTotal}`);

// ------------------------------------------------------------------ GeoJSON + join
const geo = JSON.parse(fs.readFileSync(path.join(DATA, 'countries.geojson'), 'utf8'));
const restBy3 = new Map<string, Rest>(), restBy2 = new Map<string, Rest>();
for (const r of rest) {
  if (r.codes.alpha_3) restBy3.set(r.codes.alpha_3, r);
  if (r.codes.alpha_2) restBy2.set(r.codes.alpha_2, r);
}
const A3_FIELDS = ['ISO_A3', 'ISO_A3_EH', 'ADM0_A3', 'GU_A3', 'SU_A3', 'BRK_A3', 'WB_A3'];
const A2_FIELDS = ['ISO_A2', 'ISO_A2_EH', 'WB_A2'];
const usable = (v: unknown): v is string => typeof v === 'string' && v !== '-99' && v !== '-1' && v !== '';

type Poly = number[][][];
interface Shape { id: string; name: string; rest: Rest | null; polys: Poly[]; label: [number, number] }
const shapes: Shape[] = [];
const usedRest = new Set<Rest>();
const viaFallback: string[] = [];
const unmatchedGeo: string[] = [];

// d3-geo is spherical: an exterior ring must be clockwise, or the polygon means "the whole globe
// except this shape". Natural Earth rings are not consistently wound, so rewind any polygon whose
// spherical area exceeds a hemisphere.
let rewound = 0;
function rewind(poly: Poly): Poly {
  if (geoArea({ type: 'Polygon', coordinates: poly } as any) <= 2 * Math.PI) return poly;
  rewound++;
  return poly.map((ring) => [...ring].reverse());
}
const polysOf = (g: any): Poly[] => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(rewind);

for (const f of geo.features) {
  const p = f.properties;
  let hit: Rest | null = null, via = '';
  for (const k of A3_FIELDS) {
    const v = p[k];
    if (!hit && usable(v) && restBy3.has(v) && !usedRest.has(restBy3.get(v))) { hit = restBy3.get(v); via = `${k}=${v}`; }
  }
  for (const k of A2_FIELDS) {
    const v = p[k];
    if (!hit && usable(v) && restBy2.has(v) && !usedRest.has(restBy2.get(v))) { hit = restBy2.get(v); via = `${k}=${v} (alpha-2)`; }
  }
  const label: [number, number] = [p.LABEL_X, p.LABEL_Y];
  if (hit) {
    usedRest.add(hit);
    if (!via.startsWith('ISO_A3=')) viaFallback.push(`${p.NAME.padEnd(26)} -> ${hit.names.common} [${hit.codes.alpha_3}] via ${via}`);
    shapes.push({ id: hit.codes.alpha_3, name: hit.names.common, rest: hit, polys: polysOf(f.geometry), label });
  } else {
    unmatchedGeo.push(`${p.NAME.padEnd(26)} ISO_A3=${p.ISO_A3} ADM0_A3=${p.ADM0_A3} TYPE=${p.TYPE}`);
    shapes.push({ id: `NE-${p.ADM0_A3}`, name: p.NAME, rest: null, polys: polysOf(f.geometry), label });
  }
}
console.log(`\n=== JOIN REPORT ===`);
console.log(`polygons rewound for d3-geo winding: ${rewound}`);
console.log(`GeoJSON features: ${geo.features.length}, matched: ${shapes.filter((s) => s.rest).length}`);
console.log(`Matched via a fallback code field:`); viaFallback.forEach((s) => console.log(`  ${s}`));
console.log(`GeoJSON features with NO REST match (${unmatchedGeo.length}) - drawn, not playable:`); unmatchedGeo.forEach((s) => console.log(`  ${s}`));
const unmatchedRest = rest.filter((r) => !usedRest.has(r));
console.log(`REST records with NO GeoJSON match (${unmatchedRest.length}):`);
for (const r of unmatchedRest) console.log(`  ${r.names.common.padEnd(36)} ${r.codes.alpha_3 || '(no alpha3)'} borders=[${r.borders.join(',')}]`);

// ------------------------------------------------------------------ geometry helpers
const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
function hav([lo1, la1]: number[], [lo2, la2]: number[]) {
  const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const polyAreaKm2 = (poly: Poly) => geoArea({ type: 'Polygon', coordinates: poly } as any) * R * R;
const shapeArea = (s: Shape) => s.polys.reduce((a, p) => a + polyAreaKm2(p), 0);
function centroid(ring: number[][]): [number, number] {
  let x = 0, y = 0;
  for (const [a, b] of ring) { x += a; y += b; }
  return [x / ring.length, y / ring.length];
}
function minDistKm(a: number[][], b: number[][]) {
  let d = Infinity;
  const step = Math.max(1, Math.floor(b.length / 400));
  for (const v of a) for (let k = 0; k < b.length; k += step) d = Math.min(d, hav(v, b[k]));
  return d;
}
function farParts(s: Shape): number[] {
  const areas = s.polys.map(polyAreaKm2);
  const main = areas.indexOf(Math.max(...areas));
  return s.polys.map((p, i) => (i !== main && minDistKm(p[0], s.polys[main][0]) > OVERSEAS_KM ? i : -1)).filter((i) => i >= 0);
}

// ------------------------------------------------------------------ overseas split
console.log(`\n=== OVERSEAS PARTS ===`);
for (const code of OVERSEAS_SPLIT) {
  const s = shapes.find((x) => x.id === code);
  if (!s) { fail(`OVERSEAS_SPLIT country ${code} not found`); continue; }
  const far = new Set(farParts(s));
  const parts = s.polys.filter((_, i) => far.has(i));
  s.polys = s.polys.filter((_, i) => !far.has(i));
  parts.forEach((p, i) => {
    const c = centroid(p[0]);
    // Name the split shape after the nearest unmatched REST territory, if close.
    let nm = `${s.name} (overseas)`, best = 600;
    for (const r of unmatchedRest) {
      const d = hav(c, [r.coordinates.lng, r.coordinates.lat]);
      if (d < best) { best = d; nm = r.names.common; }
    }
    shapes.push({ id: `${code}-OVS-${i + 1}`, name: nm, rest: null, polys: [p], label: c });
    console.log(`  split ${s.name} part at (${c.map((v) => v.toFixed(1)).join(', ')}) -> non-playable shape "${nm}"`);
  });
}

// ------------------------------------------------------------------ geometry adjacency
interface Part { shape: number; poly: Poly; overseas: boolean }
const parts: Part[] = [];
shapes.forEach((s, si) => {
  const far = new Set(farParts(s));
  s.polys.forEach((poly, i) => parts.push({ shape: si, poly, overseas: far.has(i) }));
});
const cell = TOUCH_TOL_DEG;
const grid = new Map<string, [number, number, number][]>();
parts.forEach((pt, pi) => {
  for (const ring of pt.poly) for (const [x, y] of ring) {
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    let a = grid.get(key); if (!a) grid.set(key, (a = [])); a.push([pi, x, y]);
  }
});
const pairPts = new Map<string, number>();
parts.forEach((pt, pi) => {
  for (const ring of pt.poly) for (const [x, y] of ring) {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    const seen = new Set<number>();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const [pj, x2, y2] of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (parts[pj].shape === pt.shape || seen.has(pj)) continue;
        if (Math.abs(x - x2) <= TOUCH_TOL_DEG && Math.abs(y - y2) <= TOUCH_TOL_DEG) {
          seen.add(pj); const k = `${pi}|${pj}`; pairPts.set(k, (pairPts.get(k) ?? 0) + 1);
        }
      }
    }
  }
});
const adj = new Map<string, Set<string>>(shapes.map((s) => [s.id, new Set()]));
const link = (a: string, b: string) => { adj.get(a)!.add(b); adj.get(b)!.add(a); };
const pointTouches = new Set<string>();
for (const [k, n] of pairPts) {
  const [pi, pj] = k.split('|').map(Number);
  if (pi > pj) continue;
  const m = Math.min(n, pairPts.get(`${pj}|${pi}`) ?? 0);
  const a = parts[pi], b = parts[pj];
  const ida = shapes[a.shape].id, idb = shapes[b.shape].id;
  if (m < MIN_SHARED_PTS) { pointTouches.add([ida, idb].sort().join('|')); continue; }
  if (a.overseas || b.overseas) {
    const o = a.overseas ? a : b, other = o === a ? b : a;
    fail(`overseas part of ${shapes[o.shape].name} touches ${shapes[other.shape].name}; add it to OVERSEAS_SPLIT`);
    continue;
  }
  link(ida, idb);
}
const byId = new Map(shapes.map((s) => [s.id, s]));
const nm = (id: string) => byId.get(id)?.name ?? id;
for (const [a, b] of MANUAL_ADJACENCY) {
  if (!byId.has(a) || !byId.has(b)) { fail(`MANUAL_ADJACENCY ${a}-${b}: unknown code`); continue; }
  link(a, b);
}
const pointOnly = [...pointTouches].filter((k) => { const [a, b] = k.split('|'); return !adj.get(a)!.has(b); });
console.log(`Single-point touches ignored: ${pointOnly.map((k) => k.split('|').map(nm).join(' - ')).join('; ') || 'none'}`);
console.log(`Manual adjacency added: ${MANUAL_ADJACENCY.map(([a, b]) => `${nm(a)} - ${nm(b)}`).join('; ') || 'none'}`);

// ------------------------------------------------------------------ geometry vs REST
console.log(`\n=== ADJACENCY: GEOMETRY vs REST borders ===`);
const joined = shapes.filter((s) => s.rest);
const joinedIds = new Set(joined.map((s) => s.id));
const pairSet = (fn: (s: Shape) => string[]) => {
  const out = new Set<string>();
  for (const s of joined) for (const b of fn(s)) if (joinedIds.has(b)) out.add([s.id, b].sort().join('|'));
  return out;
};
const G = pairSet((s) => [...adj.get(s.id)!]);
const RB = pairSet((s) => s.rest.borders);
const fmt = (k: string) => k.split('|').map(nm).join(' - ');
const manualKeys = new Set(MANUAL_ADJACENCY.map((p) => [...p].sort().join('|')));
console.log(`geometry pairs: ${G.size}, REST pairs: ${RB.size}`);
console.log(`In GEOMETRY but not REST:`);
for (const k of [...G].filter((k) => !RB.has(k)).sort()) console.log(`  ${fmt(k)}`);
console.log(`In REST but not GEOMETRY (not used):`);
for (const k of [...RB].filter((k) => !G.has(k)).sort()) console.log(`  ${fmt(k)}`);
console.log(`Manual edges that REST confirms: ${[...manualKeys].filter((k) => RB.has(k)).map(fmt).join('; ') || 'none'}`);
for (const s of joined) for (const b of s.rest.borders) if (!joinedIds.has(b)) console.log(`  REST border to a code not on the map: ${s.name} -> ${b}`);

// ------------------------------------------------------------------ playable pool
console.log(`\n=== PLAYABLE POOL ===`);
const excluded = new Map<string, string>();
for (const s of joined) {
  const landNeighbors = [...adj.get(s.id)!].filter((n) => joinedIds.has(n));
  if (!landNeighbors.length) excluded.set(s.id, 'no land borders on map');
  else if (EXCLUDED.includes(s.id)) excluded.set(s.id, 'config EXCLUDED list');
}
for (const id of EXCLUDED) if (!joinedIds.has(id)) fail(`EXCLUDED code ${id} not found`);
const seen = new Set<string>();
const comps: string[][] = [];
for (const s of joined) {
  if (excluded.has(s.id) || seen.has(s.id)) continue;
  const comp: string[] = [], st = [s.id]; seen.add(s.id);
  while (st.length) {
    const x = st.pop()!; comp.push(x);
    for (const y of adj.get(x)!) if (joinedIds.has(y) && !excluded.has(y) && !seen.has(y)) { seen.add(y); st.push(y); }
  }
  comps.push(comp);
}
comps.sort((a, b) => b.length - a.length);
const componentOf = new Map<string, number>();
let ci = 0;
for (const comp of comps) {
  const keep = comp.length >= MIN_COMPONENT;
  if (keep) { comp.forEach((c) => componentOf.set(c, ci)); ci++; }
  else comp.forEach((c) => excluded.set(c, `component of size ${comp.length} (< ${MIN_COMPONENT})`));
  console.log(`\nComponent (${comp.length})${keep ? ` PLAYABLE #${ci - 1}` : ' too small'}: ${comp.map(nm).sort().join(', ')}`);
}
console.log(`\nPlayable countries: ${componentOf.size}`);
console.log(`Excluded (${excluded.size}):`);
const byReason = new Map<string, string[]>();
for (const [c, why] of excluded) { if (!byReason.has(why)) byReason.set(why, []); byReason.get(why)!.push(nm(c)); }
for (const [why, ns] of byReason) console.log(`  [${why}] (${ns.length}): ${ns.sort().join(', ')}`);

// ------------------------------------------------------------------ content files
interface Draft<T> { status: string; entries: T[] }
function loadDraft<T extends { alpha3: string }>(file: string): Map<string, T> {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) { console.warn(`WARNING: data/${file} missing`); return new Map(); }
  const j = JSON.parse(fs.readFileSync(p, 'utf8')) as Draft<T>;
  return new Map(j.entries.map((e) => [e.alpha3, e]));
}
const landmarks = loadDraft<{ alpha3: string; hint: string }>('landmarks.json');
const religions = loadDraft<{ alpha3: string } & Religion>('religion.json');
console.log(`\n=== CONTENT FILES ===`);
const missingL = [...componentOf.keys()].filter((c) => !landmarks.has(c));
const missingR = [...componentOf.keys()].filter((c) => !religions.has(c));
console.log(`landmarks: ${landmarks.size} entries, missing for playable: ${missingL.map(nm).join(', ') || 'none'}`);
console.log(`religion:  ${religions.size} entries, missing for playable: ${missingR.map(nm).join(', ') || 'none'}`);
for (const k of [...landmarks.keys(), ...religions.keys()]) if (!componentOf.has(k)) console.log(`  entry for non-playable code ${k}`);

// ------------------------------------------------------------------ facts + countries.json
function factsOf(s: Shape): Facts {
  const r = s.rest;
  const caps = [...r.capitals].sort((a: any, b: any) => Number(!!b.attributes?.primary) - Number(!!a.attributes?.primary));
  return {
    continents: r.continents,
    subregion: r.subregion,
    landlocked: r.landlocked,
    languages: r.languages.map((l: any) => l.name),
    currencies: r.currencies.map((c: any) => ({ code: c.code, name: c.name })),
    drivingSide: r.cars.driving_side,
    population: r.population,
    areaKm2: r.area.kilometers,
    borderCount: [...adj.get(s.id)!].filter((n) => joinedIds.has(n)).length,
    capitals: caps.map((c: any) => c.name),
    status: STATUS[s.id] ?? DEFAULT_STATUS,
  };
}
for (const k of Object.keys(STATUS)) if (!componentOf.has(k)) fail(`STATUS code ${k} is not playable`);

const countries: Record<string, Country> = {};
for (const s of shapes) {
  const area = shapeArea(s);
  const rel = religions.get(s.id);
  countries[s.id] = {
    id: s.id,
    name: s.name,
    playable: componentOf.has(s.id),
    component: componentOf.get(s.id) ?? -1,
    neighbors: [...adj.get(s.id)!].sort(),
    label: [+s.label[0].toFixed(3), +s.label[1].toFixed(3)],
    tiny: area < TINY_AREA_KM2,
    facts: s.rest ? factsOf(s) : null,
    religion: rel ? { religion: rel.religion, basis: rel.basis } : null,
    landmark: landmarks.get(s.id)?.hint ?? null,
  };
}

// ------------------------------------------------------------------ simplify (topology-preserving)
const fc = {
  type: 'FeatureCollection',
  features: shapes.map((s) => ({
    type: 'Feature', id: s.id, properties: {},
    geometry: s.polys.length === 1 ? { type: 'Polygon', coordinates: s.polys[0] } : { type: 'MultiPolygon', coordinates: s.polys },
  })),
};
const topo: any = presimplify(topology({ countries: fc } as any) as any);
const minWeight = quantile(topo, SIMPLIFY_KEEP);
const geoms: any[] = topo.objects.countries.geometries;
const ringsOf = (g: any): number[][] => (g.type === 'Polygon' ? g.arcs : g.type === 'MultiPolygon' ? g.arcs.flat() : []);
const arcOf = (i: number) => topo.arcs[i < 0 ? ~i : i];
const protect = (ring: number[]) => ring.forEach((i) => arcOf(i).forEach((pt: number[]) => { pt[2] = Infinity; }));
let protectedRings = 0;
for (const g of geoms) {
  const tiny = countries[g.id].tiny;
  for (const ring of ringsOf(g)) {
    const kept = ring.reduce((n, i) => n + arcOf(i).filter((pt: number[]) => pt[2] >= minWeight).length - 1, 0) + 1;
    if (tiny || kept < 4) { protect(ring); protectedRings++; }
  }
}
// Simplifying can flip a small ring's orientation, which d3-geo would draw as "the whole globe
// minus this ring". Detect such polygons, keep their rings at full detail, and simplify again.
const polygonsOfGeom = (g: any): number[][][] => (g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : []);
let simplified: any;
let inverted: string[] = [];
for (let pass = 0; pass < 10; pass++) {
  simplified = quantize(simplify(topo, minWeight) as any, 1e5);
  inverted = [];
  simplified.objects.countries.geometries.forEach((sg: any, gi: number) => {
    const f: any = feature(simplified, sg);
    const polys = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.coordinates ?? [];
    polys.forEach((poly: Poly, pi: number) => {
      if (geoArea({ type: 'Polygon', coordinates: poly } as any) > 2 * Math.PI) {
        inverted.push(`${sg.id}#${pi}`);
        polygonsOfGeom(geoms[gi])[pi].forEach((ring) => { protect(ring); protectedRings++; });
      }
    });
  });
  if (!inverted.length) break;
  console.log(`simplification pass ${pass + 1}: re-protecting inverted polygons ${inverted.join(', ')}`);
}
if (inverted.length) fail(`inverted polygons remain after simplification: ${inverted.join(', ')}`);
console.log(`\n=== SIMPLIFICATION ===`);
console.log(`kept ~${SIMPLIFY_KEEP * 100}% of vertices; ${protectedRings} rings protected (tiny countries, < 4 points, or orientation flipped)`);
console.log(`inverted polygons in output: ${inverted.length}`);

// ------------------------------------------------------------------ post-simplification checks
console.log(`\n=== TINY-POLYGON / SELECTABILITY CHECK (after simplification) ===`);
const simpleFeatures = new Map<string, any>();
for (const g of simplified.objects.countries.geometries) simpleFeatures.set(g.id, feature(simplified, g));
const rows: string[] = [];
for (const c of Object.values(countries)) {
  const f = simpleFeatures.get(c.id);
  const a = f?.geometry ? geoArea(f) * R * R : 0;
  if (!f || !f.geometry || a <= 0) { if (c.playable) fail(`playable ${c.name} has no geometry after simplification`); continue; }
  if (c.playable && (c.tiny || a < TINY_AREA_KM2)) rows.push(`  ${c.name.padEnd(16)} ${a.toFixed(2).padStart(9)} km²  (raw ${shapeArea(byId.get(c.id)!).toFixed(2)} km²)  -> extra hit target: ${c.tiny ? 'yes' : 'NO'}`);
}
console.log(`Playable countries below ${TINY_AREA_KM2} km²:`);
rows.forEach((r) => console.log(r));
const playableMissing = [...componentOf.keys()].filter((id) => !simpleFeatures.get(id)?.geometry);
console.log(`Playable countries present with geometry: ${componentOf.size - playableMissing.length}/${componentOf.size}`);

// ------------------------------------------------------------------ write
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'world.topo.json'), JSON.stringify(simplified));
fs.writeFileSync(path.join(OUT, 'countries.json'), JSON.stringify({ countries }));
const kb = (f: string) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0);
console.log(`\nwrote public/data/world.topo.json (${kb('world.topo.json')} KB), public/data/countries.json (${kb('countries.json')} KB)`);
if (failures) { console.error(`\n${failures} error(s)`); process.exit(1); }
