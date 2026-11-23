// Admin panel: sign in with the Supabase user you created, then read every submitted result.
// The page itself is public; row-level security means the data is only returned to the admin.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/game.config.ts';
import type { CountryData } from './logic/types.ts';

interface Row {
  player_id: string; puzzle_number: number; difficulty?: 'easy' | 'medium' | 'hard'; status: 'won' | 'gaveup'; guesses: number; par: number;
  start: string; target: string; route: string[]; created_at: string;
}

const TOKEN_KEY = 'mystery-destination:admin-token';
const root = document.getElementById('root')!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtDate = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const num = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '–');

let names: Record<string, string> = {};
const nm = (id: string) => names[id] ?? id;

function getToken(): string | null { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } }
function setToken(t: string | null) {
  try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

function showLogin(message = '') {
  root.innerHTML = `
    <h1>Admin</h1><p class="muted">Sign in with the admin user from your Supabase project.</p>
    <form class="login" id="login">
      <input id="email" type="email" placeholder="Email" autocomplete="username" required />
      <input id="password" type="password" placeholder="Password" autocomplete="current-password" required />
      <button class="btn" type="submit">Sign in</button>
      <div class="err" id="err">${esc(message)}</div>
    </form>`;
  document.getElementById('login')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('err')!;
    err.textContent = 'Signing in…';
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: (document.getElementById('email') as HTMLInputElement).value,
          password: (document.getElementById('password') as HTMLInputElement).value,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.access_token) { err.textContent = 'Wrong email or password.'; return; }
      setToken(body.access_token);
      load();
    } catch { err.textContent = 'Could not reach the server.'; }
  });
}

/** Fetch every row, newest first, 1000 at a time. */
async function fetchAll(token: string): Promise<Row[] | 'unauthorized'> {
  const rows: Row[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/results?select=*&order=created_at.desc`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Range-Unit': 'items', Range: `${from}-${from + 999}` },
    });
    if (res.status === 401 || res.status === 403) return 'unauthorized';
    if (!res.ok) throw new Error(String(res.status));
    const page = (await res.json()) as Row[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function load() {
  const token = getToken();
  if (!token) return showLogin();
  root.innerHTML = '<p class="muted">Loading…</p>';
  try {
    if (!Object.keys(names).length) {
      const data = (await (await fetch(`${import.meta.env.BASE_URL}data/countries.json`)).json()) as CountryData;
      names = Object.fromEntries(Object.values(data.countries).map((c) => [c.id, c.name]));
    }
    const rows = await fetchAll(token);
    if (rows === 'unauthorized') { setToken(null); return showLogin('Session expired. Sign in again.'); }
    render(rows);
  } catch {
    root.innerHTML = '<p class="err">Could not load results.</p><button class="btn" id="retry">Retry</button>';
    document.getElementById('retry')!.addEventListener('click', load);
  }
}

function table(head: string[], body: string[][]): string {
  return `<div class="tbl-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
    body.map((r) => `<tr>${r.map((c) => `<td${c.startsWith('<span class="route"') ? ' class="route"' : ''}>${c}</td>`).join('')}</tr>`).join('')
  }</tbody></table></div>`;
}

function render(rows: Row[]) {
  const wins = rows.filter((r) => r.status === 'won');
  const byPlayer = new Map<string, Row[]>();
  // One row per daily puzzle: day number + difficulty (older rows without one count as medium).
  const diff = (r: Row) => r.difficulty ?? 'medium';
  const ORDER = { easy: 0, medium: 1, hard: 2 } as const;
  const cap = (d: string) => d[0].toUpperCase() + d.slice(1);
  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    (byPlayer.get(r.player_id) ?? byPlayer.set(r.player_id, []).get(r.player_id)!).push(r);
    const k = `${r.puzzle_number}|${diff(r)}`;
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(r);
  }
  const winPct = (rs: Row[]) => (rs.length ? `${Math.round((100 * rs.filter((r) => r.status === 'won').length) / rs.length)}%` : '–');
  const winGuesses = (rs: Row[]) => rs.filter((r) => r.status === 'won').map((r) => r.guesses);

  const players = [...byPlayer.entries()]
    .map(([id, rs]) => ({ id, rs, last: rs[0].created_at }))
    .sort((a, b) => b.rs.length - a.rs.length || (a.last < b.last ? 1 : -1));
  const days = [...byDay.values()].sort((a, b) => b[0].puzzle_number - a[0].puzzle_number || ORDER[diff(a[0])] - ORDER[diff(b[0])]);

  root.innerHTML = `
    <div class="bar"><div><h1>Admin</h1><span class="muted">${rows.length} results loaded</span></div>
      <div style="display:flex;gap:8px"><button class="btn secondary" id="csv">Download CSV</button>
      <button class="btn secondary" id="refresh">Refresh</button><button class="btn secondary" id="out">Sign out</button></div></div>
    <div class="tiles">
      <div><b>${players.length}</b><span>Players</span></div>
      <div><b>${rows.length}</b><span>Games finished</span></div>
      <div><b>${winPct(rows)}</b><span>Win rate</span></div>
      <div><b>${num(avg(winGuesses(rows)))}</b><span>Avg guesses (wins)</span></div>
      <div><b>${num(avg(wins.map((r) => r.guesses - r.par)), 1)}</b><span>Avg vs par (wins)</span></div>
    </div>
    <h2>Players</h2>
    ${table(['Player', 'Games', 'Won', 'Win %', 'Avg guesses', 'Last played'], players.map((p) => [
      `<code>${esc(p.id.slice(0, 8))}</code>`, String(p.rs.length), String(p.rs.filter((r) => r.status === 'won').length),
      winPct(p.rs), num(avg(winGuesses(p.rs))), fmtDate(p.last),
    ]))}
    <h2>By puzzle</h2>
    ${table(['#', 'Difficulty', 'Destination', 'Par', 'Played', 'Win %', 'Avg guesses'], days.map((rs) => [
      String(rs[0].puzzle_number), cap(diff(rs[0])), esc(nm(rs[0].target)), String(rs[0].par), String(rs.length), winPct(rs), num(avg(winGuesses(rs))),
    ]))}
    <h2>Every result</h2>
    ${table(['When', 'Player', '#', 'Difficulty', 'Result', 'Guesses', 'Par', 'Route'], rows.slice(0, 500).map((r) => [
      fmtDate(r.created_at), `<code>${esc(r.player_id.slice(0, 8))}</code>`, String(r.puzzle_number), cap(diff(r)),
      r.status === 'won' ? '<span class="win">Won</span>' : '<span class="loss">Gave up</span>',
      String(r.guesses), String(r.par),
      `<span class="route">${esc([r.start, ...r.route].map(nm).join(' → '))}</span>`,
    ]))}
    ${rows.length > 500 ? '<p class="muted">Showing the newest 500. The CSV has everything.</p>' : ''}`;

  document.getElementById('refresh')!.addEventListener('click', load);
  document.getElementById('out')!.addEventListener('click', () => { setToken(null); showLogin(); });
  document.getElementById('csv')!.addEventListener('click', () => downloadCsv(rows));
}

function downloadCsv(rows: Row[]) {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const head = ['created_at', 'player_id', 'puzzle_number', 'difficulty', 'status', 'guesses', 'par', 'start', 'target', 'route'];
  const lines = [head.join(',')].concat(rows.map((r) =>
    [r.created_at, r.player_id, r.puzzle_number, r.difficulty ?? 'medium', r.status, r.guesses, r.par, nm(r.start), nm(r.target), r.route.map(nm).join(' > ')].map(cell).join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  a.download = 'atlas-trail-results.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  root.innerHTML = '<h1>Admin</h1><p>Not configured yet. Set <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> in <code>config/game.config.ts</code> (see README, "Admin panel").</p>';
} else load();
