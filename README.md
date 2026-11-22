# Atlas Trail

A daily geography puzzle. You start from a known country and grow a connected trail of
countries, one border at a time, until you find the hidden destination. Every guess unlocks
another hint. Static site: Vite + TypeScript, d3-geo and d3-zoom, no backend.

The name, dates, difficulty and hint order all live in `config/game.config.ts`.

## Run it

```sh
npm install        # once
npm run dev        # open the printed localhost URL
npm run dev -- --host   # also reachable from a phone on the same Wi-Fi
```

Practice mode: add `#practice` to the URL, or press **Practice** in the header.
Clear the site's local storage (`mystery-destination:*` keys) to replay the day.

## Publish it

```sh
npm run build      # validates puzzles, typechecks, writes dist/
```

Upload `dist/` to any static host (GitHub Pages, Netlify, Cloudflare Pages). Before launch:

1. Set `LAUNCH_DATE` (puzzle #1, America/Los_Angeles) and, once you have one, `SHARE_URL`.
2. Run `npm run gen:puzzles` (365 days from the launch date). Regenerate again before the year runs out.

## Admin panel

`/admin.html` lists every player (anonymous random id), their results, win rates, a per-puzzle table and a CSV export.
A static site has no database, so this uses a free Supabase project (no SDK, plain fetch):

1. Create a project at supabase.com. In **SQL Editor** run `supabase/schema.sql` (first replace `YOUR_ADMIN_EMAIL`).
2. **Authentication → Users → Add user**: that email plus a strong password. Turn off public sign-ups
   (Authentication → Providers → Email → disable "Allow new users to sign up").
3. Copy the Project URL and the `anon` key (Settings → API) into `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `config/game.config.ts`. The anon key is meant to be public.
4. `npm run build`, deploy, open `/admin.html` and sign in.

Players can only insert their own finished daily game; only your login can read. Leave the two settings empty to run with no data collection.

## Editing content

`data/landmarks.json` and `data/religion.json` are DRAFTS. Review every entry, starting with
`"confidence": "low"`. After any change to `data/` or the config:

```sh
npm run build:data && npm run gen:puzzles && npm run validate
```

Regenerating changes which puzzle falls on which day, so finish edits before launch.

## Scripts

| Command | What it does |
|---|---|
| `npm run build:data` | raw data → `public/data/` (simplified map + countries), prints the join, border and pool reports |
| `npm run gen:puzzles` | seeded 365-day schedule → `public/data/puzzles.json` |
| `npm run validate` | checks every puzzle against the rules; exits nonzero on failure |
| `npm test` | unit tests for the game logic |

## Layout

- `config/`: all tunable settings
- `scripts/`: data build, puzzle generator, validator (run directly by Node)
- `src/logic/`: rules with no DOM: graph, legality, hints, info card, par, scoring, daily date, stats
- `src/ui/`: map rendering and local storage; `src/main.ts` wires it together
- `tests/`: `node --test` unit tests
