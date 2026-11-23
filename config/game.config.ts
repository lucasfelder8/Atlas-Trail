// Central configuration. Shared by build scripts, puzzle generator, validator and the app.

/** The game's name: page title, header and share text all use this. */
export const GAME_NAME = 'Atlas Trail';
/** Optional public URL appended to shared results once the game is published (e.g. 'https://atlastrail.example'). */
export const SHARE_URL = '';

/** First puzzle date (America/Los_Angeles). Puzzle #1 is this day. */
export const LAUNCH_DATE = '2026-11-21';
export const PUZZLE_DAYS = 365;
export const PUZZLE_SEED = 20261121;
export const TIME_ZONE = 'America/Los_Angeles';

/** Shortest path (number of guesses needed) bounds, inclusive. */
export const MIN_PAR = 3;
export const MAX_PAR = 8;
/**
 * Three daily puzzles, one per difficulty, each with its own par range (inclusive). Practice uses
 * the same bands. Together they must cover MIN_PAR..MAX_PAR.
 */
export const DAILY_DIFFICULTIES = { easy: [3, 4], medium: [5, 6], hard: [7, 8] } as const;
/**
 * Reject puzzles where no country on any shortest route (other than the target) matches
 * a single checkable hint: those play as "✗ on every card" and feel broken.
 */
export const REQUIRE_ROUTE_MATCH = true;
/**
 * Giant countries that border far-apart regions. Par (and so the number of hints) is the
 * shortest route that does NOT pass through these, unless there is no way around them.
 * Players may still use them as shortcuts and beat par.
 */
export const PAR_AVOIDS = ['RUS', 'CHN'];
/** A target may not repeat within this many days. */
// With three destinations a day from ~150 targets, 45 days is about the longest gap that still works
// (60 runs out of hard puzzles in the second month).
export const TARGET_REPEAT_DAYS = 45;
/** A country may not appear at all (as start or target) within this many days of its last appearance. */
export const APPEARANCE_GAP_DAYS = 7;

/** Countries with land borders that are nonetheless excluded from play (alpha-3). */
export const EXCLUDED = ['IDN', 'PNG', 'TLS', 'BRN', 'IRL', 'GBR', 'HTI', 'DOM'];
/** Only connected components at least this large are playable. */
export const MIN_COMPONENT = 8;

/** Real borders too short to show as more than a point on the 50m map. Added by hand. */
export const MANUAL_ADJACENCY: [string, string][] = [['BWA', 'ZMB']];

/** Countries whose far-away polygons are split into separate, non-playable map shapes. */
export const OVERSEAS_SPLIT = ['FRA'];
/** A polygon farther than this from its country's largest polygon counts as overseas. */
export const OVERSEAS_KM = 1500;

/** Geometry adjacency: vertices within this many degrees count as touching. */
export const TOUCH_TOL_DEG = 0.01;
/** ...and at least this many touching vertices are needed (a shared edge, not a point). */
export const MIN_SHARED_PTS = 2;

/** Countries under this area (km², raw geometry) are "tiny": never simplified, get a hit target. */
export const TINY_AREA_KM2 = 2000;

/**
 * Political status for places that are not ordinary sovereign states.
 * Anything not listed is "Sovereign state". The status hint is only used for listed targets.
 */
export const STATUS: Record<string, string> = {
  HKG: 'Special administrative region (not sovereign)',
  MAC: 'Special administrative region (not sovereign)',
  UNK: 'Partially recognized state',
  PSE: 'Partially recognized state',
  ESH: 'Disputed territory (not sovereign)',
};
export const DEFAULT_STATUS = 'Sovereign state';

/** Middle-hint priority order. Reorder freely; continent is always first, landmark always last. */
export const HINT_ORDER = [
  'status',
  'language',
  'landlocked',
  'subregion',
  'religion',
  'currency',
  'driving',
  'population',
  'borders',
  'capitalLetter',
  'area',
] as const;

/**
 * Give-away languages are revealed late: the language hint moves to just before the
 * LATE_LANGUAGE_BEFORE hint (so short puzzles may not show it at all). A language counts as a give-away
 * when at most LATE_LANGUAGE_MAX_COUNTRIES playable countries speak it (Korean, Chinese, Thai…).
 * Languages named after the target (Russian for Russia) are never shown: they leak the name.
 */
export const LATE_LANGUAGE_MAX_COUNTRIES = 3;
export const LATE_LANGUAGE_BEFORE: (typeof HINT_ORDER)[number] = 'population';

/** Well-known reference countries for relative population/area hints, with display names. */
export const REFERENCE_COUNTRIES: Record<string, string> = {
  USA: 'the USA',
  CAN: 'Canada',
  RUS: 'Russia',
  CHN: 'China',
  BRA: 'Brazil',
  FRA: 'France',
  DEU: 'Germany',
  IND: 'India',
  AUS: 'Australia',
};

/**
 * Optional results collection for the admin panel (admin.html). Leave both empty to disable it:
 * the game then runs fully offline. See README, "Admin panel". The anon key is meant to be public;
 * row-level security (supabase/schema.sql) is what protects the data.
 */
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
