// App wiring: loads data, owns the current state, and re-renders on every change.
// Two modes: the daily puzzle (default) and practice (#practice), which never touches stats.
import type { Topology } from 'topojson-specification';
import type { CountryData, Puzzle } from './logic/types.ts';
import { MIN_PAR, MAX_PAR, REQUIRE_ROUTE_MATCH } from '../config/game.config.ts';
import { playableGraph, shortestPath } from './logic/graph.ts';
import { parGraph } from './logic/par.ts';
import { visitedSet, tap, targetIsAdjacent } from './logic/legality.ts';
import { neighbors } from './logic/graph.ts';
import { buildHints, revealedCount, canShowOnMap, countriesMatching, type Hint, type HintKind } from './logic/hints.ts';
import { cardFor, matchLevel } from './logic/infoCard.ts';
import { shareSquares, shareText, HELPER_EMOJI } from './logic/scoring.ts';
import { laDate, puzzleNumber, msUntilNextPuzzle, formatCountdown } from './logic/daily.ts';
import { eligibleTargets, pickPuzzle } from './logic/puzzleGen.ts';
import {
  applyGuess, giveUp, useHelper, newGame, recordResult, displayStreak, winRate, averageGuesses,
  type GameState, type Stats,
} from './logic/state.ts';
import { WorldMap } from './ui/map.ts';
import { submitResult } from './ui/telemetry.ts';
import {
  loadGame, saveGame, loadStats, saveStats, hasSeenHelp, markHelpSeen, loadPrefs, savePrefs,
  loadPractice, savePractice, type Difficulty,
} from './ui/storage.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const HINT_ICONS: Record<HintKind, string> = {
  continent: '🌍', status: '🏳️', subregion: '🗺️', landlocked: '⚓', language: '🗣️', religion: '🛐',
  currency: '💰', driving: '🚗', population: '👥', borders: '🤝', capitalLetter: '🔤', area: '📐', landmark: '🏛️',
};
const DIFFICULTY: Record<Difficulty, [number, number]> = {
  easy: [3, 4], medium: [5, 6], hard: [7, 8], any: [MIN_PAR, MAX_PAR],
};

/** "Continent: Europe" -> muted "Continent:" + bold "Europe"; other phrasings stay bold. */
function hintHtml(h: Hint): string {
  if (h.kind === 'landmark') return esc(h.text);
  const i = h.text.indexOf(': ');
  return i < 0 ? esc(h.text) : `<span class="k">${esc(h.text.slice(0, i + 1))}</span> ${esc(h.text.slice(i + 2))}`;
}

async function loadJson<T>(file: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${file}?v=${__DATA_VERSION__}`);
  if (!res.ok) throw new Error(`failed to load ${file}`);
  return res.json() as Promise<T>;
}

async function main() {
  const practice = location.hash === '#practice';
  window.addEventListener('hashchange', () => location.reload());

  const [topo, data, { puzzles }] = await Promise.all([
    loadJson<Topology>('world.topo.json'),
    loadJson<CountryData>('countries.json'),
    loadJson<{ puzzles: Puzzle[] }>('puzzles.json'),
  ]);
  const g = playableGraph(data);
  const ctx = { countries: data.countries };
  const prefs = loadPrefs();
  const today = laDate();
  const number = puzzleNumber(today);

  // ------------------------------------------------------------ choose the puzzle
  function newPracticePuzzle(difficulty: Difficulty) {
    const [minPar, maxPar] = DIFFICULTY[difficulty];
    const p = pickPuzzle(Math.random, g, ctx, eligibleTargets(g, ctx, minPar), { minPar, maxPar, requireRouteMatch: REQUIRE_ROUTE_MATCH });
    if (!p) throw new Error('could not generate a practice puzzle');
    savePractice({ puzzle: p, game: newGame(0, p.start, p.target) });
  }

  let puzzle: { start: string; target: string; par: number };
  let game: GameState;
  if (practice) {
    if (!loadPractice()) newPracticePuzzle(prefs.practiceDifficulty ?? 'any');
    const saved = loadPractice()!;
    puzzle = saved.puzzle;
    game = saved.game;
  } else {
    const found = puzzles.find((p) => p.number === number);
    if (!found) {
      document.body.innerHTML = `<p style="padding:24px">No puzzle is scheduled for ${esc(today)}. <a href="#practice">Play a practice puzzle</a>.</p>`;
      return;
    }
    puzzle = found;
    const saved = loadGame();
    game = saved && saved.number === number && saved.start === puzzle.start && saved.target === puzzle.target
      ? saved
      : newGame(number, puzzle.start, puzzle.target);
  }
  const persist = () => (practice ? savePractice({ puzzle, game }) : saveGame(game));
  persist();

  const target = data.countries[puzzle.target];
  const hints: Hint[] = buildHints(target, puzzle.par, ctx);
  const nameOf = (id: string) => data.countries[id].name;
  let stats: Stats = loadStats();
  let selected: string | null = null;
  let shownHints = -1;
  /** Hint index currently shown on the map by the helper, or null. */
  let helperHint: number | null = null;
  let helperSet: ReadonlySet<string> = new Set();

  const over = () => game.status !== 'playing';
  const visited = () => visitedSet(game.start, game.guesses);
  const map = new WorldMap($('map'), topo, data, onTap);

  // ------------------------------------------------------------ toast
  let toastTimer: number | undefined;
  function toast(msg: string, shake = false) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('shake');
    void el.offsetWidth; // restart animation
    el.classList.add('show');
    if (shake) el.classList.add('shake');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove('show'), 1600);
  }

  // ------------------------------------------------------------ interactions
  function onTap(id: string | null) {
    hideReveal();
    if (id === null) { if (selected) { selected = null; render(); } return; }
    const r = tap(g, visited(), id, over());
    if (r.kind === 'toast') { toast(r.message, true); return; } // nothing else happens
    selected = r.id;
    render();
    // Keep the tapped country visible above the card once it has slid in.
    window.setTimeout(() => { if (selected === r.id) map.revealCountry(r.id, $('card').offsetHeight + 16); }, 260);
  }

  function onGuess(id: string) {
    const r = tap(g, visited(), id, over());
    if (r.kind !== 'select' || !r.canGuess) return;
    game = applyGuess(game, id);
    persist();
    if (game.status === 'won') { finish(); return; }
    const n = revealedCount(puzzle.par, game.guesses.length, false);
    const unlocked = n > revealedCount(puzzle.par, game.guesses.length - 1, false);
    selected = null;
    render();
    if (unlocked) revealHint(n - 1, `Not ${nameOf(id)}`); else toast('Not it. Keep going');
    if (!map.isInView(id)) map.zoomTo([...visited()]);
  }

  // ------------------------------------------------------------ big on-map hint reveal
  let revealTimer: number | undefined;
  let hideTimer: number | undefined;
  /** Pop the hint up in the middle of the map; it fades after a few seconds or on tap. */
  function revealHint(i: number, lead?: string) {
    const h = hints[i];
    const el = $<HTMLButtonElement>('hint-reveal');
    const last = i === puzzle.par - 1;
    const label = i === 0 ? 'Your first hint' : last ? `Final hint · ${i + 1} of ${puzzle.par}` : `New hint · ${i + 1} of ${puzzle.par}`;
    const ms = last ? 4500 : 3000;
    el.className = `hint-reveal${h.kind === 'landmark' ? ' landmark' : ''}`;
    el.innerHTML = `
      ${lead ? `<span class="rv-tap" style="margin:0 0 8px">${esc(lead)}.</span>` : ''}
      <span class="rv-label">${label}</span>
      <span class="rv-ico" aria-hidden="true">${HINT_ICONS[h.kind]}</span>
      <span class="rv-text">${hintHtml(h)}</span>
      <span class="rv-bar" style="animation-duration:${ms}ms"></span>
      <span class="rv-tap">Tap anywhere to close</span>`;
    el.setAttribute('aria-label', `${label}: ${h.text}`);
    clearTimeout(hideTimer); // a pending fade-out from the previous hint must not hide this one
    el.hidden = false;
    clearTimeout(revealTimer);
    revealTimer = window.setTimeout(hideReveal, ms);
  }
  // Tapping anywhere (map, buttons, background) dismisses the hint; the tap still does its normal job.
  document.addEventListener('pointerdown', () => hideReveal(), true);
  function hideReveal() {
    const el = $('hint-reveal');
    if (el.hidden) return;
    clearTimeout(revealTimer);
    el.classList.add('out');
    hideTimer = window.setTimeout(() => { el.hidden = true; el.classList.remove('out'); }, 280);
  }

  // ------------------------------------------------------------ hint helper (optional "easy mode")
  function startHelper(i: number) {
    helperHint = i;
    helperSet = new Set(countriesMatching(hints[i], target, ctx));
    selected = null;
    game = useHelper(game);
    persist();
    render();
    map.resetZoom(); // show the whole world so every highlighted country is visible
  }
  function stopHelper() {
    if (helperHint === null) return;
    helperHint = null;
    helperSet = new Set();
    render();
    map.zoomTo([...visited(), ...(g.get(game.start) ?? [])]);
  }
  /** Tap 💡 on a hint: confirm the first time (it marks the result), then show the matching countries. */
  function onHelperButton(i: number) {
    if (over()) return;
    if (helperHint === i) { stopHelper(); return; }
    if (game.helped) { startHelper(i); return; }
    const dlg = $<HTMLDialogElement>('helper-dlg');
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', () => { if (dlg.returnValue === 'ok' && !over()) startHelper(i); }, { once: true });
  }

  function finish() {
    helperHint = null;
    helperSet = new Set();
    hideReveal();
    if (!practice) { stats = recordResult(stats, game, puzzle.par); saveStats(stats); submitResult(game, puzzle.par); }
    selected = null;
    render();
    zoomToResult();
    window.setTimeout(showEnd, game.status === 'won' ? 800 : 300);
  }

  const parRoute = () => shortestPath(parGraph(g, game.start, game.target), game.start, game.target) ?? [];

  /** Frame the visited region, the target and the drawn route. */
  function zoomToResult() {
    map.zoomTo([...visited(), game.target, ...parRoute()]);
  }

  // ------------------------------------------------------------ render
  function render() {
    const vis = visited();
    const n = revealedCount(puzzle.par, game.guesses.length, over());
    const revealed = hints.slice(0, n);

    $('puzzle-no').innerHTML = practice ? '<span class="practice-tag">Practice</span>' : `#${number}`;
    $('mode-btn').textContent = practice ? 'Daily' : 'Practice';
    $('start-name').textContent = nameOf(game.start);
    renderHints(revealed, n);

    const nearTarget = over() ? [] : neighbors(g, game.target).filter((n) => vis.has(n));
    $('alert').hidden = !targetIsAdjacent(g, vis, game.target) || over();
    $('alert-text').textContent = nearTarget.length
      ? `Hot! The destination borders ${nearTarget.map(nameOf).join(' and ')}. It's one of that country's neighbors.`
      : '';

    const k = game.guesses.length;
    $('guess-count').textContent = game.status === 'won' ? `Solved in ${k} · par ${puzzle.par}`
      : game.status === 'gaveup' ? `Gave up after ${k} ${k === 1 ? 'guess' : 'guesses'}`
      : `${k} ${k === 1 ? 'guess' : 'guesses'} so far`;
    $('giveup-btn').hidden = over();
    $('results-btn').hidden = !over();
    $('new-practice-btn').hidden = !practice || !over();

    let route: string[] | null = null;
    if (game.status === 'won') route = shortestPath(g, game.start, game.target, vis);
    if (game.status === 'gaveup') route = parRoute();
    const pinned = [game.start, ...game.guesses.slice(-1), ...(over() ? [game.target] : [])];
    const shades = new Map([...vis].map((id) => [id, matchLevel(data.countries[id], target, revealed, ctx)] as const));
    map.render({ visited: vis, start: game.start, selected, target: over() ? game.target : null, route, pinned, shades, borderTarget: new Set(nearTarget), hinted: helperSet });
    renderHelperBar();

    renderCard(vis, revealed);
  }

  function renderHelperBar() {
    const bar = $('helper-bar');
    bar.hidden = helperHint === null || over();
    if (bar.hidden) return;
    $('helper-title').textContent = hints[helperHint!].text;
    const n = helperSet.size;
    $('helper-count').textContent = `${n} ${n === 1 ? 'country fits' : 'countries fit'} in yellow · the destination is one of them`;
  }

  function renderHints(revealed: Hint[], n: number) {
    const fresh = shownHints >= 0 && n > shownHints;
    const items = revealed.map((h, i) => {
      const isNew = fresh && i >= shownHints;
      const cls = ['hint', h.kind === 'landmark' ? 'landmark' : '', isNew ? 'new' : '', i === n - 1 ? 'latest' : ''].join(' ');
      const helper = !over() && canShowOnMap(h)
        ? `<button class="helper-btn" data-helper="${i}" aria-pressed="${helperHint === i}" aria-label="${helperHint === i ? 'Hide' : 'Show'} countries that fit: ${esc(h.text)}">💡 ${helperHint === i ? 'Hide' : 'Map'}</button>`
        : '';
      return `<li class="${cls}"><span class="ico" aria-hidden="true">${HINT_ICONS[h.kind]}</span>
        <span class="txt">${hintHtml(h)}</span>${isNew ? '<span class="badge">NEW</span>' : ''}${helper}</li>`;
    });
    if (n < puzzle.par) {
      const left = puzzle.par - n;
      const next = n + 1 === puzzle.par ? 'the landmark' : 'another hint';
      items.push(`<li class="hint locked"><span class="ico" aria-hidden="true">🔒</span>
        <span class="txt">Your next guess unlocks ${next}${left > 1 ? ` · ${left} to go, landmark last` : ''}</span></li>`);
    }
    $('hint-list').innerHTML = items.join('');
    for (const b of document.querySelectorAll<HTMLButtonElement>('#hint-list [data-helper]'))
      b.addEventListener('click', () => onHelperButton(Number(b.dataset.helper)));
    $('hint-count').textContent = `${n} of ${puzzle.par}`;
    const list = $('hint-list');
    if (fresh) list.scrollTop = list.scrollHeight;
    shownHints = n;
    const collapsed = !!prefs.hintsCollapsed;
    document.querySelector('.hints')!.classList.toggle('collapsed', collapsed);
    $('hints-toggle').setAttribute('aria-expanded', String(!collapsed));
  }

  function renderCard(vis: Set<string>, revealed: Hint[]) {
    const el = $('card');
    const model = selected ? cardFor(g, vis, selected, target, revealed, ctx, over()) : null;
    if (!model) { el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); return; }
    const rows = model.rows.map((r) => {
      if (r.match === null) {
        return `<li class="row landmark"><span><span class="k">Landmark hint</span><br>${esc(r.value)}</span></li>`;
      }
      const cls = r.match ? 'match' : 'nomatch';
      return `<li class="row ${cls}">
        <span class="icon" aria-hidden="true">${r.match ? '✓' : '✗'}</span>
        <span class="val"><span class="k">${esc(r.label)}:</span> ${esc(r.value)}
          <span class="sr-only">${r.match ? 'matches the destination' : 'does not match the destination'}</span></span>
        <span class="cmp">${r.match ? 'Same as the destination' : `Destination: ${esc(r.targetValue ?? '')}`}</span></li>`;
    }).join('');
    const bordersTarget = !over() && neighbors(g, game.target).includes(model.id);
    const tag = model.id === game.start ? 'Start' : vis.has(model.id) ? 'Visited' : '';
    const summary = model.checkable
      ? `<b>${model.matches} of ${model.checkable}</b> ${model.checkable === 1 ? 'hint matches' : 'hints match'} the destination`
      : 'No hints to compare yet';
    el.innerHTML = `
      <div class="card-head"><h2>${esc(model.name)}${tag ? `<span class="tag">${tag}</span>` : ''}</h2>
        <button class="close" aria-label="Close">×</button></div>
      ${bordersTarget ? `<p class="borders-banner"><span aria-hidden="true">🎯</span> Borders the destination${vis.has(model.id) ? '' : ': guess it and the destination is right next door'}</p>` : ''}
      <p class="summary">${summary}</p>
      <ul class="rows">${rows}</ul>
      ${model.showGuessButton ? `<button class="btn" id="guess-btn">Guess ${esc(model.name)}</button>` : ''}`;
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    el.querySelector('.close')!.addEventListener('click', () => { selected = null; render(); });
    el.querySelector('#guess-btn')?.addEventListener('click', () => onGuess(model.id));
  }

  // ------------------------------------------------------------ dialogs
  let countdownTimer: number | undefined;
  const countdownHtml = () => `<div class="countdown">Next puzzle in <b class="cd">${formatCountdown(msUntilNextPuzzle())}</b></div>`;
  function startCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = window.setInterval(() => {
      const ms = msUntilNextPuzzle();
      document.querySelectorAll('.cd').forEach((e) => (e.textContent = formatCountdown(ms)));
      if (!practice && laDate() !== today) location.reload();
    }, 1000);
  }

  function statsHtml() {
    const dist = Object.entries(stats.distribution).map(([k, v]) => [Number(k), v] as const).sort((a, b) => a[0] - b[0]);
    const max = Math.max(1, ...dist.map(([, v]) => v));
    const mine = !practice && game.status === 'won' ? game.guesses.length : -1;
    return `
      <div class="end-stats">
        <div><b>${stats.played}</b><span>Played</span></div>
        <div><b>${winRate(stats)}%</b><span>Win rate</span></div>
        <div><b>${displayStreak(stats, number)}</b><span>Streak</span></div>
        <div><b>${stats.maxStreak}</b><span>Best streak</span></div>
        <div><b>${stats.wins ? averageGuesses(stats).toFixed(1) : '–'}</b><span>Avg guesses</span></div>
        <div><b>${stats.wins}</b><span>Solved</span></div>
      </div>
      <h3 style="margin:8px 0 4px;font-size:15px">Guess distribution</h3>
      ${dist.length ? `<div class="dist">${dist.map(([k, v]) => `
        <div class="dist-row"><span class="k">${k}</span>
          <span class="bar" style="width:${Math.max(8, (100 * v) / max)}%;${k === mine ? '' : 'opacity:.7'}">${v}</span></div>`).join('')}</div>`
        : '<p class="muted">No wins yet.</p>'}`;
  }

  function showEnd() {
    const won = game.status === 'won';
    const squares = won ? shareSquares(g, game.start, game.target, game.guesses) : [];
    const text = won ? shareText(practice ? null : number, game.guesses.length, puzzle.par, squares, !!game.helped) : '';
    const chips = (ids: string[]) => ids.map((id) => `<span class="c${id === game.target ? ' t' : ''}">${esc(nameOf(id))}</span>`).join(' → ');
    const k = game.guesses.length;
    $('end-body').innerHTML = `
      <h2 id="end-title">${won ? `You found ${esc(target.name)}! 🎉` : `It was ${esc(target.name)}`}</h2>
      <p>${won
        ? `<b>${k}</b> ${k === 1 ? 'guess' : 'guesses'} · par <b>${puzzle.par}</b>${k < puzzle.par ? ' · under par!' : k === puzzle.par ? ' · perfect route!' : ''}`
        : `The par route was <b>${puzzle.par}</b> guesses:`}</p>
      ${won ? '' : `<div class="end-route">${chips(parRoute())}</div>`}
      ${won ? `<div class="share-preview" aria-label="Share preview">${squares.join('')}${game.helped ? ` ${HELPER_EMOJI}` : ''}</div>
        ${game.helped ? `<p class="muted" style="margin:0 0 8px">${HELPER_EMOJI} You used the map helper, so your shared result is marked.</p>` : ''}
        <button class="btn" id="share-btn">Share result</button>` : ''}
      ${practice ? '<p class="muted">Practice games don\'t count toward your stats.</p>' : statsHtml() + countdownHtml()}
      <div class="dlg-actions">
        ${practice ? '<button class="btn" id="end-new-practice">New practice puzzle</button>' : '<button class="btn secondary" id="end-practice">Practice</button>'}
        <button class="btn secondary" data-close>Look at the map</button>
      </div>`;
    const shareBtn = document.getElementById('share-btn') as HTMLButtonElement | null;
    shareBtn?.addEventListener('click', () => shareResult(text, shareBtn));
    document.getElementById('end-new-practice')?.addEventListener('click', () => { closeDialog('end-dlg'); openDialog('practice-dlg'); });
    document.getElementById('end-practice')?.addEventListener('click', () => { location.hash = 'practice'; });
    openDialog('end-dlg');
    if (!practice) startCountdown();
  }

  function showStats() {
    $('stats-body').innerHTML = `<h2 id="stats-title">Statistics</h2>
      <p class="muted" style="margin-top:0">Daily puzzles only.</p>${statsHtml()}${!practice && over() ? countdownHtml() : ''}
      ${over() ? `<div class="dlg-actions"><button class="btn" id="stats-result-btn">${practice ? 'This game' : 'Today\'s result'}</button></div>` : ''}`;
    document.getElementById('stats-result-btn')?.addEventListener('click', () => { closeDialog('stats-dlg'); showEnd(); });
    openDialog('stats-dlg');
    if (!practice && over()) startCountdown();
  }

  function openDialog(id: string) {
    const dlg = $<HTMLDialogElement>(id);
    if (!dlg.open) dlg.showModal();
  }
  function closeDialog(id: string) { $<HTMLDialogElement>(id).close(); }

  // Any [data-close] button, or a tap on the dark backdrop, closes its dialog. Esc works natively.
  for (const dlg of document.querySelectorAll('dialog')) {
    dlg.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const r = dlg.getBoundingClientRect();
      const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if ((t === dlg && outside) || t.closest('[data-close]')) dlg.close();
    });
  }

  /**
   * Share: the phone's share sheet when available, else the clipboard, else a copy from a text box
   * placed INSIDE the open dialog (a modal dialog makes the rest of the page inert). Feedback is
   * shown on the button itself because toasts sit behind the dialog backdrop.
   */
  async function shareResult(text: string, btn: HTMLButtonElement) {
    const done = (label: string) => {
      btn.textContent = label;
      window.setTimeout(() => (btn.textContent = 'Share result'), 2200);
    };
    const touch = matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.share) {
      try { await navigator.share({ text }); return done('Shared ✓'); } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      return done('Copied to clipboard ✓');
    } catch { /* not a secure context, or permission denied: fall through */ }
    const host = btn.closest('dialog') ?? document.body;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    host.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    if (ok) return done('Copied to clipboard ✓');
    // Last resort: show the text so it can be copied by hand.
    if (!host.querySelector('.copy-fallback')) {
      const box = document.createElement('textarea');
      box.className = 'copy-fallback';
      box.readOnly = true;
      box.value = text;
      btn.after(box);
      box.select();
    }
    done('Select the text below to copy');
  }

  // ------------------------------------------------------------ wiring
  $('giveup-btn').addEventListener('click', () => {
    const dlg = $<HTMLDialogElement>('confirm-dlg');
    $('confirm-text').textContent = practice ? 'This ends this practice game.' : "This ends today's game.";
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok' || over()) return;
      game = giveUp(game);
      persist();
      finish();
    }, { once: true });
  });
  $('hint-reveal').addEventListener('click', hideReveal);
  $('helper-close').addEventListener('click', stopHelper);
  $('results-btn').addEventListener('click', showEnd);
  $('new-practice-btn').addEventListener('click', () => openDialog('practice-dlg'));
  $('mode-btn').addEventListener('click', () => {
    if (practice) { location.hash = ''; return; }
    location.hash = 'practice';
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-difficulty]')) {
    b.addEventListener('click', () => {
      const d = b.dataset.difficulty as Difficulty;
      prefs.practiceDifficulty = d;
      savePrefs(prefs);
      newPracticePuzzle(d);
      if (practice) location.reload(); else location.hash = 'practice';
    });
  }
  $('stats-btn').addEventListener('click', showStats);
  $('help-btn').addEventListener('click', () => openDialog('help-dlg'));
  $('focus-btn').addEventListener('click', () => map.zoomTo([...visited()]));
  $('world-btn').addEventListener('click', () => map.resetZoom());
  $('hints-toggle').addEventListener('click', () => {
    prefs.hintsCollapsed = !prefs.hintsCollapsed;
    savePrefs(prefs);
    render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selected && !document.querySelector('dialog[open]')) { selected = null; render(); }
  });

  render();
  if (over()) {
    // Daily: locked until the next puzzle. The result can be dismissed to explore the map.
    if (!practice && !stats.results[number]) { stats = recordResult(stats, game, puzzle.par); saveStats(stats); }
    if (!practice) submitResult(game, puzzle.par); // idempotent; also retries an earlier offline failure
    zoomToResult();
    showEnd();
  } else {
    // The whole world is shown first, then we glide to the start region.
    window.setTimeout(() => map.zoomTo([...visited(), ...(g.get(game.start) ?? [])], 900), 500);
    const firstHint = () => { if (game.guesses.length === 0) window.setTimeout(() => revealHint(0), 1500); };
    if (!hasSeenHelp()) {
      markHelpSeen();
      openDialog('help-dlg');
      $('help-dlg').addEventListener('close', firstHint, { once: true });
    } else firstHint();
  }
}

main().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<p style="padding:24px">Could not load the game. Please refresh.</p>`;
});
