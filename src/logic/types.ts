export type ReligionName =
  | 'Christianity'
  | 'Islam'
  | 'Hinduism'
  | 'Buddhism'
  | 'Judaism'
  | 'Folk/Traditional'
  | 'Unaffiliated';

export interface Religion {
  religion: ReligionName;
  basis: 'official' | 'majority' | 'none';
}

export interface Facts {
  continents: string[];
  subregion: string;
  landlocked: boolean;
  /** Official/primary languages, in REST order. */
  languages: string[];
  currencies: { code: string; name: string }[];
  drivingSide: 'left' | 'right';
  population: number;
  areaKm2: number;
  /** Land neighbours on the map (any joined country, playable or not). */
  borderCount: number;
  /** All capitals; the first is the primary one. */
  capitals: string[];
  status: string;
}

export interface Country {
  id: string;
  name: string;
  playable: boolean;
  /** Index of the playable component, or -1. */
  component: number;
  /** Map neighbours (ids of any map shape, playable or not). */
  neighbors: string[];
  /** [lon, lat] point for labels, hit targets and route lines. */
  label: [number, number];
  tiny: boolean;
  facts: Facts | null;
  religion: Religion | null;
  landmark: string | null;
  /** Bonus fun facts, revealed one per guess after par and cycled (data/funfacts.json). */
  funFacts?: string[];
}

export interface CountryData {
  countries: Record<string, Country>;
}

export type DailyDifficulty = 'easy' | 'medium' | 'hard';
export const DAILY_ORDER: readonly DailyDifficulty[] = ['easy', 'medium', 'hard'];

export interface Puzzle {
  /** Day number (1 = launch day); each day has one puzzle per difficulty. */
  number: number;
  date: string;
  difficulty: DailyDifficulty;
  start: string;
  target: string;
  par: number;
}
