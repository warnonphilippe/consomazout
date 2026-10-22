import type { ConsumptionAnalysis, TimedRefill } from './consumption';
import { forEachDaySlice } from './degree-days';
import type { MonthAverage } from './stats';
import { smoothMonthlyProfile, type DailyProfile } from './smooth';

export type ProfileKey = 'reference' | 'adjusted' | 'history';

export interface ForecastProfile {
  readonly key: ProfileKey;
  readonly label: string;
  /** Consommation attendue pour chaque mois de l'année (litres). */
  readonly monthly: number[];
  readonly available: boolean;
  /** Pourquoi le profil n'est pas (encore) disponible, ou comment il a été obtenu. */
  readonly note: string;
}

export interface ForecastPoint {
  readonly day: number;
  readonly liters: number;
}

export interface Forecast {
  readonly profile: ForecastProfile;
  readonly points: ForecastPoint[];
  /** Contenu estimé à l'instant présent. */
  readonly currentLiters: number;
  readonly alertDay: number | null;
  readonly emptyDay: number | null;
  /** Date limite de commande : seuil d'alerte moins le délai de livraison. */
  readonly orderDay: number | null;
  /** Litres à commander à la date du seuil pour remplir jusqu'au maximum autorisé. */
  readonly litersToOrder: number;
  readonly estimatedCost: number | null;
}

export interface ForecastOptions {
  readonly start: ForecastPoint;
  readonly refillsAfterStart: TimedRefill[];
  readonly now: number;
  readonly horizonDays: number;
  readonly thresholdLiters: number;
  readonly usableCapacity: number;
  readonly leadDays: number;
  readonly lastPrice: number | null;
}

/** Couverture minimale (en fraction d'année « type ») pour recaler le profil statistique. */
const MIN_ADJUST_WEIGHT = 0.03;

export function buildProfiles(
  reference: number[],
  analysis: ConsumptionAnalysis | null,
  averages: MonthAverage[],
): ForecastProfile[] {
  const profiles: ForecastProfile[] = [
    {
      key: 'reference',
      label: 'Statistique belge',
      monthly: reference,
      available: true,
      note: 'Consommation de référence répartie selon les degrés-jours normaux d’Uccle.',
    },
  ];

  const referenceAnnual = reference.reduce((a, b) => a + b, 0);
  if (analysis !== null && analysis.totalWeight >= MIN_ADJUST_WEIGHT && referenceAnnual > 0) {
    const ratio = clamp(analysis.totalConsumed / (referenceAnnual * analysis.totalWeight), 0.25, 4);
    profiles.push({
      key: 'adjusted',
      label: 'Statistique ajustée',
      monthly: reference.map((v) => v * ratio),
      available: true,
      note: `Profil belge recalé sur votre consommation observée (× ${ratio.toFixed(2)}).`,
    });
  } else {
    profiles.push({
      key: 'adjusted',
      label: 'Statistique ajustée',
      monthly: reference,
      available: false,
      note: 'Encodez au moins deux relevés espacés de quelques semaines pour recaler le profil.',
    });
  }

  const missing = averages.filter((a) => a.average === null).length;
  profiles.push({
    key: 'history',
    label: 'Historique de la maison',
    monthly: averages.map((a) => a.average ?? 0),
    available: missing === 0,
    note:
      missing === 0
        ? 'Moyenne réelle de chaque mois sur les années précédentes.'
        : `Pas encore assez de données : il manque ${missing} mois complet${missing > 1 ? 's' : ''} sur 12.`,
  });
  return profiles;
}

/** Meilleur profil disponible : historique, sinon statistique ajustée, sinon référence. */
export function bestProfile(profiles: ForecastProfile[]): ForecastProfile {
  for (const key of ['history', 'adjusted', 'reference'] as const) {
    const profile = profiles.find((p) => p.key === key && p.available);
    if (profile) {
      return profile;
    }
  }
  return profiles[0]!;
}

const dailyProfiles = new WeakMap<number[], DailyProfile>();

/** Consommation attendue un jour donné : profil mensuel lissé jour par jour (sans cassure au 1er du mois). */
export function dailyRate(profile: ForecastProfile, day: number): number {
  let daily = dailyProfiles.get(profile.monthly);
  if (!daily) {
    daily = smoothMonthlyProfile(profile.monthly);
    dailyProfiles.set(profile.monthly, daily);
  }
  return daily(day);
}

/**
 * Simule l'évolution du contenu depuis le dernier relevé : consommation journalière du profil,
 * pleins encodés depuis ce relevé, jusqu'à `now + horizonDays`.
 */
export function simulate(profile: ForecastProfile, options: ForecastOptions): Forecast {
  const end = options.now + options.horizonDays;
  const refills = options.refillsAfterStart.filter((r) => r.day > options.start.day).sort((a, b) => a.day - b.day);
  const points: ForecastPoint[] = [{ ...options.start }];
  let level = options.start.liters;
  let currentLiters = options.start.liters;
  let alertDay: number | null = level <= options.thresholdLiters ? options.start.day : null;
  let emptyDay: number | null = level <= 0 ? options.start.day : null;
  let refillIndex = 0;

  const advance = (from: number, to: number): void => {
    forEachDaySlice(from, to, (day, fraction) => {
      const sliceStart = Math.max(from, day);
      const rate = dailyRate(profile, day);
      const consumption = rate * fraction;
      const next = Math.max(0, level - consumption);
      if (alertDay === null && level > options.thresholdLiters && next <= options.thresholdLiters && rate > 0) {
        alertDay = sliceStart + (level - options.thresholdLiters) / rate;
      }
      if (emptyDay === null && level > 0 && next <= 0 && rate > 0) {
        emptyDay = sliceStart + level / rate;
      }
      level = next;
      if (options.now > sliceStart && options.now <= sliceStart + fraction) {
        currentLiters = level + rate * (sliceStart + fraction - options.now);
      }
      points.push({ day: sliceStart + fraction, liters: level });
    });
  };

  let cursor = options.start.day;
  while (cursor < end) {
    const nextRefill = refills[refillIndex];
    const stop = nextRefill !== undefined && nextRefill.day < end ? nextRefill.day : end;
    advance(cursor, stop);
    cursor = stop;
    if (nextRefill !== undefined && stop === nextRefill.day) {
      level += nextRefill.refill.liters;
      points.push({ day: stop, liters: level });
      if (level > options.thresholdLiters) {
        alertDay = null;
      }
      if (level > 0) {
        emptyDay = null;
      }
      refillIndex++;
      if (stop <= options.now) {
        currentLiters = level;
      }
    }
  }
  if (options.now <= options.start.day) {
    currentLiters = options.start.liters;
  }

  const orderDay = alertDay !== null ? alertDay - options.leadDays : null;
  const litersToOrder = Math.max(0, options.usableCapacity - options.thresholdLiters);
  return {
    profile,
    points,
    currentLiters,
    alertDay,
    emptyDay,
    orderDay,
    litersToOrder,
    estimatedCost: options.lastPrice !== null ? litersToOrder * options.lastPrice : null,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
