import { measureOf, type Reading, type Refill, type Tank } from '../models/app-data.model';
import { forEachDaySlice, seasonalDayWeight, seasonalWeightBetween } from './degree-days';
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
  /** Pleins livrés dans l'intervalle, dans l'ordre. */
  readonly deliveries: TimedRefill[];
  /** Répartition de la consommation entre les pleins (un segment de plus que de pleins). */
  readonly segments: ConsumptionSegment[];
}

/** Portion d'intervalle sans livraison : la consommation y suit le poids saisonnier jour par jour. */
export interface ConsumptionSegment {
  readonly from: number;
  readonly to: number;
  readonly weight: number;
  readonly liters: number;
}

export interface LevelPoint {
  readonly day: number;
  readonly liters: number;
}

export interface RefillMark {
  readonly refill: Refill;
  readonly day: number;
  /** Contenu juste après la livraison. */
  readonly liters: number;
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

  const capacity = capacityLiters(tank);
  const bucketOf = (day: number) => {
    const { year, month } = yearMonthOf(day);
    const key = monthKey(year, month);
    const bucket = buckets.get(key) ?? { year, month, liters: 0, coveredDays: 0 };
    buckets.set(key, bucket);
    return bucket;
  };

  for (let i = 1; i < levels.length; i++) {
    const from = levels[i - 1]!;
    const to = levels[i]!;
    const inInterval = deliveries.filter((d) => d.day > from.day && d.day <= to.day);
    const refilled = inInterval.reduce((sum, d) => sum + d.refill.liters, 0);
    const rawConsumed = from.liters + refilled - to.liters;
    const consumed = Math.max(0, rawConsumed);
    const days = to.day - from.day;
    const segments = allocateSegments(from, to, inInterval, consumed, capacity, hotWaterShare);
    const weight = segments.reduce((sum, seg) => sum + seg.weight, 0);

    for (const seg of segments) {
      if (seg.weight > 0) {
        forEachDaySlice(seg.from, seg.to, (day, fraction) => {
          bucketOf(day).liters += (seg.liters * fraction * seasonalDayWeight(day, hotWaterShare)) / seg.weight;
        });
      } else if (seg.liters > 0) {
        bucketOf(seg.from).liters += seg.liters;
      }
    }
    forEachDaySlice(from.day, to.day, (day, fraction) => {
      bucketOf(day).coveredDays += fraction;
    });

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
      deliveries: inInterval,
      segments,
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
    if (end <= start) {
      continue;
    }
    coveredDays += end - start;
    for (const seg of interval.segments) {
      const segStart = Math.max(start, seg.from);
      const segEnd = Math.min(end, seg.to);
      if (segEnd <= segStart || seg.weight <= 0) {
        continue;
      }
      liters += (seg.liters * seasonalWeightBetween(segStart, segEnd, analysis.hotWaterShare)) / seg.weight;
    }
  }
  return { liters, coveredDays };
}

/**
 * Évolution reconstituée du contenu entre le premier et le dernier relevé : diminution jour par jour
 * selon la consommation répartie, saut vertical à chaque livraison. Renvoie aussi le niveau atteint
 * juste après chaque plein, pour placer les marqueurs.
 */
export function levelSeries(analysis: ConsumptionAnalysis): { points: LevelPoint[]; refills: RefillMark[] } {
  const points: LevelPoint[] = [];
  const refills: RefillMark[] = [];
  const first = analysis.levels[0];
  if (first) {
    points.push({ day: first.day, liters: first.liters });
  }
  for (const interval of analysis.intervals) {
    let level = interval.from.liters;
    interval.segments.forEach((seg, index) => {
      if (seg.weight > 0) {
        forEachDaySlice(seg.from, seg.to, (day, fraction) => {
          level -= (seg.liters * fraction * seasonalDayWeight(day, analysis.hotWaterShare)) / seg.weight;
          points.push({ day: Math.max(seg.from, day) + fraction, liters: Math.max(0, level) });
        });
      } else {
        level -= seg.liters;
        points.push({ day: seg.to, liters: Math.max(0, level) });
      }
      const delivery = interval.deliveries[index];
      if (delivery) {
        level += delivery.refill.liters;
        points.push({ day: delivery.day, liters: Math.max(0, level) });
        refills.push({ refill: delivery.refill, day: delivery.day, liters: Math.max(0, level) });
      }
    });
    // Incohérence (niveau remonté sans plein suffisant) : saut jusqu'au relevé.
    if (Math.abs(level - interval.to.liters) > 0.5) {
      points.push({ day: interval.to.day, liters: interval.to.liters });
    }
  }
  return { points, refills };
}

/**
 * Répartit la consommation d'un intervalle entre les livraisons. Au départ, au prorata du poids
 * saisonnier ; puis ajustée pour rester physiquement possible : la cuve ne descend pas sous zéro
 * avant un plein et ne déborde pas après (le plein doit tenir dans la cuve).
 */
function allocateSegments(
  from: ReadingLevel,
  to: ReadingLevel,
  deliveries: TimedRefill[],
  consumed: number,
  capacity: number,
  hotWaterShare: number,
): ConsumptionSegment[] {
  const bounds = [from.day, ...deliveries.map((d) => d.day), to.day];
  const weights = bounds.slice(1).map((end, i) => seasonalWeightBetween(bounds[i]!, end, hotWaterShare));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  // Consommation cumulée à chaque livraison.
  const cumulative: number[] = [];
  let weightSoFar = 0;
  let previous = 0;
  let deliveredBefore = 0;
  deliveries.forEach((delivery, k) => {
    weightSoFar += weights[k]!;
    const proportional = totalWeight > 0 ? (consumed * weightSoFar) / totalWeight : 0;
    const max = from.liters + deliveredBefore; // la cuve ne peut pas être vide avant le plein
    const min = from.liters + deliveredBefore + delivery.refill.liters - capacity; // le plein doit tenir
    const value = Math.min(consumed, Math.max(previous, Math.min(max, Math.max(min, proportional))));
    cumulative.push(value);
    previous = value;
    deliveredBefore += delivery.refill.liters;
  });
  cumulative.push(consumed);

  return weights.map((weight, i) => ({
    from: bounds[i]!,
    to: bounds[i + 1]!,
    weight,
    liters: cumulative[i]! - (i > 0 ? cumulative[i - 1]! : 0),
  }));
}
