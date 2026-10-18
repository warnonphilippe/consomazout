import { measureOf, type Reading, type Refill, type Tank } from '../models/app-data.model';
import { forEachDaySlice, seasonalDayWeight } from './degree-days';
import { capacityLiters, measureToLiters } from './tank-volume';
import { daysInMonth, monthKey, toDayNumber, yearMonthOf } from './time';

export interface ReadingLevel {
  readonly reading: Reading;
  readonly day: number;
  readonly liters: number;
}

export interface ConsumptionInterval {
  readonly from: ReadingLevel;
  readonly to: ReadingLevel;
  /** Litres livrés entre les deux relevés. */
  readonly refilled: number;
  /** Consommation brute (peut être négative en cas d'incohérence). */
  readonly rawConsumed: number;
  /** Consommation retenue (jamais négative). */
  readonly consumed: number;
  readonly days: number;
  readonly litersPerDay: number;
  /** Le niveau a augmenté sans plein suffisant : plein oublié ou erreur de relevé. */
  readonly anomaly: boolean;
  /** Somme des poids saisonniers de l'intervalle (fraction d'année « type »). */
  readonly weight: number;
}

export interface MonthBucket {
  readonly key: string;
  readonly year: number;
  readonly month: number;
  readonly liters: number;
  readonly coveredDays: number;
  readonly days: number;
  /** Mois entièrement couvert par des relevés : utilisable pour les moyennes. */
  readonly complete: boolean;
}

export interface ConsumptionAnalysis {
  readonly levels: ReadingLevel[];
  readonly intervals: ConsumptionInterval[];
  readonly months: MonthBucket[];
  readonly totalConsumed: number;
  readonly totalWeight: number;
  readonly hotWaterShare: number;
}

export interface TimedRefill {
  readonly refill: Refill;
  readonly day: number;
}

/**
 * Relevés valides triés chronologiquement, avec leur contenu en litres : hauteur convertie selon
 * la cuve, ou quantité lue sur la jauge. Une hauteur est ignorée si la cuve n'a pas de dimensions (jauge).
 */
export function readingLevels(tank: Tank, readings: Reading[]): ReadingLevel[] {
  return readings
    .flatMap((reading) => {
      const measure = measureOf(reading);
      if (measure === null || (measure.kind === 'height' && tank.shape === 'gauge')) {
        return [];
      }
      return [{ reading, day: toDayNumber(reading.date), liters: measureToLiters(tank, measure) }];
    })
    .filter((level) => Number.isFinite(level.day) && Number.isFinite(level.liters))
    .sort((a, b) => a.day - b.day || a.reading.id.localeCompare(b.reading.id));
}

export function timedRefills(refills: Refill[]): TimedRefill[] {
  return refills
    .map((refill) => ({ refill, day: toDayNumber(refill.date) }))
    .filter((r) => Number.isFinite(r.day) && r.refill.liters > 0)
    .sort((a, b) => a.day - b.day);
}

/**
 * Reconstitue la consommation à partir des relevés et des pleins.
 * Un plein daté exactement comme un relevé est considéré comme fait juste avant ce relevé.
 * La consommation de chaque intervalle est répartie jour par jour selon le poids saisonnier,
 * ce qui donne des totaux mensuels réalistes même avec des relevés espacés.
 */
export function analyzeConsumption(
  tank: Tank,
  readings: Reading[],
  refills: Refill[],
  hotWaterShare: number,
): ConsumptionAnalysis {
  const levels = readingLevels(tank, readings);
  const deliveries = timedRefills(refills);
  const tolerance = Math.max(5, capacityLiters(tank) * 0.01);
  const intervals: ConsumptionInterval[] = [];
  const buckets = new Map<string, { year: number; month: number; liters: number; coveredDays: number }>();
  let totalConsumed = 0;
  let totalWeight = 0;

  for (let i = 1; i < levels.length; i++) {
    const from = levels[i - 1]!;
    const to = levels[i]!;
    const refilled = deliveries
      .filter((d) => d.day > from.day && d.day <= to.day)
      .reduce((sum, d) => sum + d.refill.liters, 0);
    const rawConsumed = from.liters + refilled - to.liters;
    const consumed = Math.max(0, rawConsumed);
    const days = to.day - from.day;

    const slices: { day: number; fraction: number; weight: number }[] = [];
    let weight = 0;
    forEachDaySlice(from.day, to.day, (day, fraction) => {
      const w = fraction * seasonalDayWeight(day, hotWaterShare);
      slices.push({ day, fraction, weight: w });
      weight += w;
    });

    for (const slice of slices) {
      const { year, month } = yearMonthOf(slice.day);
      const key = monthKey(year, month);
      const bucket = buckets.get(key) ?? { year, month, liters: 0, coveredDays: 0 };
      bucket.liters += weight > 0 ? (consumed * slice.weight) / weight : 0;
      bucket.coveredDays += slice.fraction;
      buckets.set(key, bucket);
    }

    totalConsumed += consumed;
    totalWeight += weight;
    intervals.push({
      from,
      to,
      refilled,
      rawConsumed,
      consumed,
      days,
      litersPerDay: days > 0 ? consumed / days : 0,
      anomaly: rawConsumed < -tolerance,
      weight,
    });
  }

  const months = [...buckets.entries()]
    .map(([key, b]) => {
      const days = daysInMonth(b.year, b.month);
      return { key, ...b, days, complete: b.coveredDays >= days - 0.01 };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return { levels, intervals, months, totalConsumed, totalWeight, hotWaterShare };
}

/** Consommation observée entre deux instants (uniquement sur les périodes couvertes par des relevés). */
export function consumptionBetween(
  analysis: ConsumptionAnalysis,
  from: number,
  to: number,
): { liters: number; coveredDays: number } {
  let liters = 0;
  let coveredDays = 0;
  for (const interval of analysis.intervals) {
    const start = Math.max(from, interval.from.day);
    const end = Math.min(to, interval.to.day);
    if (end <= start || interval.weight <= 0) {
      continue;
    }
    let weight = 0;
    forEachDaySlice(start, end, (day, fraction) => {
      weight += fraction * seasonalDayWeight(day, analysis.hotWaterShare);
    });
    liters += (interval.consumed * weight) / interval.weight;
    coveredDays += end - start;
  }
  return { liters, coveredDays };
}
