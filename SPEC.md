Build a daily geography game called "Mystery Destination" in this folder. Read this whole file first.

CONCEPT
Each day has a fixed START country (shown to everyone) and a hidden TARGET country. The player grows a connected region of visited countries by tapping countries on a world map. Each valid guess reveals one more hint about the target. The player wins by guessing the target. There is no loss and no guess limit. Score = total valid guesses; fewer is better. It is a DAILY game: one attempt per day.

RULES
- Visited set = the start country plus every valid guess so far.
- A country is LEGAL to select only if it is in the visited set, or it borders ANY country in the visited set (not just the most recent one). Example: start Germany, guess Poland, Ukraine, Russia, then France is still legal because France borders Germany.
- Tapping an ILLEGAL country does nothing except show a short toast: "Not next to your region". No selection, no name, no info card, no cost. Tapping an excluded country (see PLAYABLE POOL) shows "Not in play" the same way.
- Guesses are permanent. No undo, no removing guesses.
- The target can only be guessed once it borders the visited set.
- ALERT: whenever the target borders any country in the visited set, show a clear banner such as "The target borders one of your countries." Keep it visible from then on. Do not say which country.
- "Give up" button (with a confirm dialog "This ends today's game"): reveals the target and a shortest route, counts as unsolved, and breaks the streak.
- NO distance or direction hints.
- Win screen: route on the map, total guesses, par (shortest possible number of guesses), share button, countdown to the next puzzle.

HINTS
- Number of hints for a puzzle = par (the shortest number of guesses from start to target). Hint 1 is shown at the start. Each valid guess reveals the next hint. When all are shown, keep showing them all.
- Hint 1 is always very broad: the continent (use the `continents` field).
- The LAST hint is always the specific "landmark" hint from data/landmarks.json (e.g. Vatican City: "Home of the pope"; Egypt: "The pyramids of Giza stand here").
- The hints in between are general facts, taken in this priority order until the count is filled: subregion, landlocked yes/no, an official language, official or majority religion, currency, driving side, population (relative to a very well-known reference country), number of bordering countries, capital's first letter, area (relative to a very well-known reference country). Make the order easy to change. Show hints in priority order, landmark last.
- Religion hint: use data/religion.json. Word it "Official religion: X" when basis is "official" and "Majority religion: X" when basis is "majority". If the target's basis is "none", skip the religion hint for that puzzle and use the next fact in the list.
- Use relative comparisons only with very well-known reference countries (USA, Canada, Russia, China, Brazil, France, Germany, India, Australia).
- No hint text may contain the target's name or capital.

INFO CARD (on selection)
- Tapping a LEGAL country selects it (highlight only) and opens an info card showing the country's NAME.
- The card lists every hint revealed so far with this country's own value and a check or cross icon (icon plus color, never color alone). Example: "Language: German ✗", "Continent: Europe ✓". Re-evaluate all revealed hints whenever a new one is revealed.
- For the religion hint, a country matches if its recorded religion equals the hint's religion, whatever the basis. A country with basis "none" shows "Religion: no clear majority" and ✗.
- The free-text landmark hint is shown on the card with no check or cross.
- A "Guess" button on the card commits the guess. Visited countries show the card but no Guess button. Tapping elsewhere changes the selection.

MAP
- The ENTIRE map is visible from the start with all country borders drawn. Names are NOT drawn on the map for unvisited countries (the start country's name is shown from the beginning). Visited countries are filled with the path color and show their names.
- Mobile-first SVG map using d3-geo with d3-zoom for pan and pinch zoom. Use a projection that looks good on a phone, like Equal Earth or Natural Earth.
- Micro-states (Vatican City, San Marino, Monaco, Liechtenstein, Andorra, etc.) are fully in play, including as start or target. They must be selectable: zoom support plus a minimum invisible hit target around very small shapes.
- Geometry simplification in the build script must NOT delete tiny polygons. Verify that every playable country is present and selectable, and show me a check (for example, list any country whose polygon area falls below a threshold).
- Do NOT highlight legal next countries.
- Preprocess the GeoJSON in a build script so the app never loads the raw 50m file at runtime.

DATA (already in /data)
- countries.geojson (Natural Earth 50m)
- rc_1.json, rc_2.json, rc_3.json (and rc_4.json if present): pages of the REST Countries v5 list endpoint (limit=100, offsets 0/100/200/300). Each file is a JSON object whose country array is at data.objects, with paging info at data.meta. Concatenate all pages and check the total against data.meta.total; print an error if they differ.
- v5 field paths (these differ from the old v3.1 API): names.common, codes.alpha_2, codes.alpha_3, borders (array of alpha-3 codes), landlocked, capitals (array of objects with name), population, area.kilometers, region, subregion, continents (array), languages (array), currencies (object), cars.driving_side ("left" or "right"), coordinates.lat, coordinates.lng, classification.sovereign, classification.un_member. Inspect the real files first and adapt to what is actually there; if any field above is missing or shaped differently, say so in your report instead of guessing.
Join the GeoJSON to the REST data on ISO alpha-3 codes (codes.alpha_3). Natural Earth uses -99 for some codes (France, Norway, Kosovo and others), so fall back to the alternative code fields. PRINT A REPORT of every country that fails to match in either direction. Do not silently drop anything.

BORDER GRAPH (important)
- The graph must match what a player sees on the map. Derive adjacency from the GEOMETRY: two countries are adjacent if their land borders touch on the map (small tolerance). Use the REST `borders` field only as a cross-check.
- PRINT a report of every disagreement between geometry-derived adjacency and REST `borders` (for example Spain-Morocco via Ceuta/Melilla should not count).
- Overseas territories must not create adjacencies or merge components. If the countries file folds them into the parent shape (France and French Guiana is the known example), tell me and propose using ne_50m_admin_0_map_units.geojson or filtering to mainland polygons. Report first; do not guess.

PLAYABLE POOL
- Exclude island nations and any country with no land borders.
- Also exclude, even though they share land borders: Indonesia, Papua New Guinea, Timor-Leste, Brunei, Ireland, United Kingdom, Haiti, Dominican Republic. Keep this as a config list.
- Use only connected components with at least 8 countries. Print the components and every excluded country so I can review the list.
- Excluded countries still appear on the map with their borders, in a lighter fill.
- Micro-states are INCLUDED as starts, targets and legal guesses.

DRAFT CONTENT FILES (do these only after I approve the playable pool)
1. data/landmarks.json: one specific, well-known, unambiguous one-line hint per playable country. It must not name the country or its capital and must not be true of any other playable country.
2. data/religion.json: for each playable country, {alpha3, religion, basis}. religion is one of: Christianity, Islam, Hinduism, Buddhism, Judaism, Folk/Traditional, Unaffiliated. basis is "official" if the country has a constitutionally or legally declared official religion, "majority" if a single religion is followed by roughly half or more of the population, otherwise "none".
Mark both files DRAFT. I will review every entry before launch. Where you are unsure, set a "confidence" field to "low" so I can check those first.

PUZZLE GENERATION
- Write a script that generates puzzles.json for the next 365 days.
- For each day: choose a start and a target from the same component. Shortest path (number of guesses needed) must be between MIN_PAR and MAX_PAR inclusive. Defaults MIN_PAR=3, MAX_PAR=8, both in config.
- Do not repeat a target within 60 days.
- Seeded random generator so output is reproducible.
- Write a validate-puzzles script that checks: both countries exist and are playable, same component, shortest path within MIN_PAR..MAX_PAR, start is not the target, the target has a landmark entry, enough general hints exist to fill the middle slots, and no hint text contains the target's name or capital. Exit nonzero on failure.
- The daily puzzle is chosen by date in the America/Los_Angeles time zone. Puzzle numbers count from a LAUNCH_DATE config value.

SHARE
- Copy to clipboard: "Mystery Destination #N - X guesses (par Y)" followed by one square per valid guess: green if that country lies on some shortest route from start to target (distance(start,c) + distance(c,target) = distance(start,target)), yellow if it was a detour. The final guess is always green. No country names.

STATE
- Save progress, completed-day results and stats (games played, win rate, current streak, average guesses, guess distribution) in localStorage. Restore an in-progress game on reload. After a win or give-up, today's game is locked until the next puzzle.

TECH
- Static site, no backend. Vite + TypeScript, no UI framework. d3-geo and d3-zoom are fine. Ask before adding any other dependency.
- Keep game logic (graph, legality, hints, info-card evaluation, scoring) in plain modules separate from rendering, with unit tests, including: the "borders any visited country" rule, hint count equals par, and that illegal countries never produce a name or a card.

PROCESS
Do not build the UI yet. First: (1) inspect the data, (2) print the join report, the geometry-vs-REST adjacency report and the playable-pool report, (3) propose a file structure, (4) list any rule ambiguities you noticed. Wait for my OK before building the rest.
