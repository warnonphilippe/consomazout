import type { Refill } from '../models/app-data.model';
import type { MonthBucket } from './consumption';

export interface MonthCell {
  readonly liters: number;
  readonly complete: boolean;
}

export interface YearRow {
  readonly year: number;
  readonly months: (MonthCell | null)[];
  readonly total: number;
  /** Les douze mois sont entièrement couverts. */
  readonly complete: boolean;
}

export interface MonthAverage {
  readonly month: number;
  /** Moyenne des mois complets, `null` si aucun mois complet. */
  readonly average: number | null;
  readonly count: number;
}

export type SeasonKey = 'winter' | 'spring' | 'summer' | 'autumn';

export interface SeasonStat {
  readonly key: SeasonKey;
  readonly label: string;
  readonly months: readonly number[];
  /** Consommation moyenne par mois de la saison (sur les mois disponibles). */
  readonly averageMonthly: number | null;
  /** Total moyen de la saison (si les trois mois ont une moyenne). */
  readonly averageTotal: number | null;
  readonly referenceTotal: number;
}

export const SEASONS: readonly { key: SeasonKey; label: string; months: readonly number[] }[] = [
  { key: 'winter', label: 'Hiver', months: [11, 0, 1] },
  { key: 'spring', label: 'Printemps', months: [2, 3, 4] },
  { key: 'summer', label: 'Été', months: [5, 6, 7] },
  { key: 'autumn', label: 'Automne', months: [8, 9, 10] },
];

export function seasonOfMonth(month: number): SeasonKey {
  return SEASONS.find((s) => s.months.includes(month))!.key;
}

export function yearRows(months: MonthBucket[]): YearRow[] {
  const byYear = new Map<number, (MonthCell | null)[]>();
  for (const bucket of months) {
    const row = byYear.get(bucket.year) ?? Array.from({ length: 12 }, () => null);
    row[bucket.month] = { liters: bucket.liters, complete: bucket.complete };
    byYear.set(bucket.year, row);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, cells]) => ({
      year,
      months: cells,
      total: cells.reduce((sum, cell) => sum + (cell?.liters ?? 0), 0),
      complete: cells.every((cell) => cell?.complete === true),
    }));
}

export function monthlyAverages(months: MonthBucket[]): MonthAverage[] {
  return Array.from({ length: 12 }, (_, month) => {
    const complete = months.filter((b) => b.month === month && b.complete);
    const count = complete.length;
    return {
      month,
      count,
      average: count > 0 ? complete.reduce((sum, b) => sum + b.liters, 0) / count : null,
    };
  });
}

export function seasonStats(averages: MonthAverage[], referenceProfile: number[]): SeasonStat[] {
  return SEASONS.map((season) => {
    const values = season.months.map((m) => averages[m]?.average ?? null);
    const known = values.filter((v): v is number => v !== null);
    return {
      ...season,
      averageMonthly: known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null,
      averageTotal: known.length === season.months.length ? known.reduce((a, b) => a + b, 0) : null,
      referenceTotal: season.months.reduce((sum, m) => sum + (referenceProfile[m] ?? 0), 0),
    };
  });
}

export interface RefillStats {
  readonly count: number;
  readonly totalLiters: number;
  readonly totalCost: number;
  /** Prix moyen pondéré par les litres. */
  readonly averagePrice: number | null;
  readonly lastPrice: number | null;
  readonly minPrice: number | null;
  readonly maxPrice: number | null;
}

export function refillStats(refills: Refill[]): RefillStats {
  const sorted = refills.slice().sort((a, b) => a.date.localeCompare(b.date));
  const priced = sorted.filter((r) => r.pricePerLiter > 0);
  const totalLiters = sorted.reduce((sum, r) => sum + r.liters, 0);
  const totalCost = sorted.reduce((sum, r) => sum + r.totalPrice, 0);
  const pricedLiters = priced.reduce((sum, r) => sum + r.liters, 0);
  const pricedCost = priced.reduce((sum, r) => sum + r.totalPrice, 0);
  const prices = priced.map((r) => r.pricePerLiter);
  return {
    count: sorted.length,
    totalLiters,
    totalCost,
    averagePrice: pricedLiters > 0 ? pricedCost / pricedLiters : null,
    lastPrice: priced.at(-1)?.pricePerLiter ?? null,
    minPrice: prices.length > 0 ? Math.min(...prices) : null,
    maxPrice: prices.length > 0 ? Math.max(...prices) : null,
  };
}
