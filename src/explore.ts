// Explore mode (#explore): no puzzle. Tap or search any country to see every fact the hints use.
import type { Topology } from 'topojson-specification';
import type { Country, CountryData } from './logic/types.ts';
import { continentLabel, normalize } from './logic/hints.ts';
import { DEFAULT_STATUS } from '../config/game.config.ts';
import { ALIASES } from './logic/search.ts';
import { WorldMap } from './ui/map.ts';
import { play } from './ui/sound.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Key/value rows for one country: the same facts the hints are built from, plus extras. */
export function exploreRows(c: Country, data: CountryData): [icon: string, label: string, value: string][] {
  const f = c.facts;
  if (!f) return [['❔', 'Facts', 'No data for this place']];
  const neighbours = c.neighbors.filter((n) => data.countries[n]?.playable).map((n) => data.countries[n].name).sort();
  const rows: [string, string, string][] = [
    ['🌍', 'Continent', continentLabel(f)],
    ['🗺️', 'Subregion', f.subregion || '–'],
  ];
  if (f.status !== DEFAULT_STATUS) rows.push(['🏳️', 'Status', f.status]);
  rows.push(
    ['⚓', 'Landlocked', f.landlocked ? 'Yes' : 'No'],
    ['🗣️', f.languages.length === 1 ? 'Language' : 'Languages', f.languages.join(', ') || '–'],
    ['🛐', 'Religion', !c.religion ? 'Unknown' : c.religion.basis === 'none' ? 'No clear majority'
      : `${c.religion.religion} (${c.religion.basis === 'official' ? 'official' : 'majority'})`],
    ['💰', f.currencies.length === 1 ? 'Currency' : 'Currencies', f.currencies.map((x) => `${x.name} (${x.code})`).join(', ') || '–'],
    ['🚗', 'Drives on the', f.drivingSide],
    ['👥', 'Population', fmtInt(f.population)],
    ['📐', 'Area', `${fmtInt(f.areaKm2)} km²`],
    ['🤝', 'Borders', `${f.borderCount}${neighbours.length ? `: ${neighbours.join(', ')}` : ''}`],
    ['🔤', f.capitals.length > 1 ? 'Capitals' : 'Capital', f.capitals.join(', ') || '–'],
  );
  return rows;
}

export function startExplore(topo: Topology, data: CountryData) {
  document.body.classList.add('exploring');
  $('puzzle-no').innerHTML = '<span class="practice-tag">Explore</span>';
  let selected: string | null = null;
  const map = new WorldMap($('map'), topo, data, (id) => select(id));

  function render() {
    const vis = new Set(selected ? [selected] : []);
    map.render({ visited: vis, start: '', selected, target: null, route: null, pinned: [...vis], shades: new Map(), borderTarget: new Set() });
    const el = $('card');
    const c = selected ? data.countries[selected] : null;
    if (!c) { el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); return; }
    const rows = exploreRows(c, data).map(([ico, k, v]) =>
      `<li class="xrow"><span class="ico" aria-hidden="true">${ico}</span><span><span class="k">${esc(k)}</span> ${esc(v)}</span></li>`).join('');
    el.innerHTML = `
      <div class="card-head"><h2>${esc(c.name)}<span class="tag">${c.playable ? 'In play' : 'Not in play'}</span></h2>
        <button class="close" aria-label="Close">×</button></div>
      <ul class="xrows">${rows}</ul>
      ${c.landmark ? `<p class="xextra"><span class="k">Landmark</span><br>🏛️ ${esc(c.landmark)}</p>` : ''}
      ${c.funFacts?.length ? `<p class="xextra"><span class="k">Fun facts</span></p><ul class="xfacts">${c.funFacts.map((x) => `<li>✨ ${esc(x)}</li>`).join('')}</ul>` : ''}`;
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    el.querySelector('.close')!.addEventListener('click', () => select(null));
  }

  function select(id: string | null) {
    if (id && !data.countries[id]?.facts) return; // unnamed map shapes (overseas parts, Antarctica...)
    selected = id;
    if (id) play('select');
    render();
    if (id) window.setTimeout(() => { if (selected === id) map.revealCountry(id, $('card').offsetHeight + 16); }, 260);
  }

  // Search any country with data (in play or not).
  const input = $<HTMLInputElement>('search');
  const list = $('search-list');
  input.placeholder = 'Find any country…';
  let hits: Country[] = [];
  let active = 0;
  const all = Object.values(data.countries).filter((c) => c.facts && c.id !== 'ATA');
  const draw = () => {
    const open = hits.length > 0 && document.activeElement === input;
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    list.innerHTML = hits.map((c, i) => `<li role="option" data-id="${c.id}" class="${i === active ? 'active' : ''}${c.playable ? '' : ' far'}" aria-selected="${i === active}">
      ${esc(c.name)}${c.playable ? '' : '<span class="why">not in play</span>'}</li>`).join('');
  };
  input.addEventListener('input', () => {
    const q = normalize(input.value.trim());
    const score = (c: Country) => {
      const names = [c.name, ...(ALIASES[c.id] ?? [])].map(normalize);
      if (names[0].startsWith(q)) return 0;
      return names.some((n) => n.split(/[\s-]+/).some((w) => w.startsWith(q))) ? 1 : -1;
    };
    hits = q ? all.map((c) => ({ c, r: score(c) })).filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.c.name.localeCompare(b.c.name)).slice(0, 6).map((x) => x.c) : [];
    active = 0;
    draw();
  });
  const pick = (c: Country) => { input.value = ''; hits = []; draw(); input.blur(); select(c.id); };
  input.addEventListener('blur', () => window.setTimeout(draw, 0));
  input.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && hits.length) {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
      draw();
    } else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); pick(hits[active]); }
    else if (e.key === 'Escape') { input.value = ''; hits = []; draw(); }
  });
  list.addEventListener('mousedown', (e) => {
    const li = (e.target as Element).closest<HTMLElement>('[data-id]');
    if (!li) return;
    e.preventDefault();
    pick(data.countries[li.dataset.id!]);
  });

  $('world-btn').addEventListener('click', () => map.resetZoom());
  $('focus-btn').textContent = 'Zoom in';
  $('focus-btn').addEventListener('click', () => { if (selected) map.zoomTo([selected]); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selected && !document.querySelector('dialog[open]')) select(null); });
  render();
}
