import type { AppData, Tank } from '../models/app-data.model';
import { analyzeConsumption, consumptionBetween, timedRefills, type ConsumptionAnalysis } from './consumption';
import { referenceMonthlyProfile } from './degree-days';
import { bestProfile, buildProfiles, simulate, type Forecast, type ForecastProfile, type ProfileKey } from './forecast';
import {
  monthlyAverages,
  refillStats,
  seasonStats,
  yearRows,
  type MonthAverage,
  type RefillStats,
  type SeasonStat,
  type YearRow,
} from './stats';
import { capacityLiters, usableCapacityLiters, validateTank } from './tank-volume';

/** Horizon des prévisions : 18 mois. */
export const FORECAST_HORIZON_DAYS = 548;

export interface FullAnalysis {
  readonly tank: Tank | null;
  readonly tankErrors: string[];
  readonly capacity: number;
  readonly usableCapacity: number;
  readonly thresholdLiters: number;
  readonly reference: number[];
  readonly consumption: ConsumptionAnalysis | null;
  readonly years: YearRow[];
  readonly averages: MonthAverage[];
  readonly seasons: SeasonStat[];
  readonly refills: RefillStats;
  readonly profiles: ForecastProfile[];
  readonly forecasts: Partial<Record<ProfileKey, Forecast>>;
  /** Prévision retenue pour les indicateurs (meilleur profil disponible). */
  readonly best: Forecast | null;
  readonly last365: { liters: number; coveredDays: number } | null;
}

export function analyze(data: AppData, now: number): FullAnalysis {
  const { settings } = data;
  const reference = referenceMonthlyProfile(settings.referenceAnnualLiters, settings.hotWaterLitersPerYear);
  const hotWaterShare =
    settings.referenceAnnualLiters > 0 ? settings.hotWaterLitersPerYear / settings.referenceAnnualLiters : 0;
  const tank = data.tank;
  const tankErrors = tank ? validateTank(tank) : ['Aucune cuve n’est encore configurée.'];
  const refills = refillStats(data.refills);

  if (tank === null || tankErrors.length > 0) {
    const averages = monthlyAverages([]);
    return {
      tank,
      tankErrors,
      capacity: 0,
      usableCapacity: 0,
      thresholdLiters: 0,
      reference,
      consumption: null,
      years: [],
      averages,
      seasons: seasonStats(averages, reference),
      refills,
      profiles: buildProfiles(reference, null, averages),
      forecasts: {},
      best: null,
      last365: null,
    };
  }

  const capacity = capacityLiters(tank);
  const usableCapacity = usableCapacityLiters(tank);
  const thresholdLiters = (capacity * settings.alertThresholdPct) / 100;
  const consumption = analyzeConsumption(tank, data.readings, data.refills, hotWaterShare);
  const averages = monthlyAverages(consumption.months);
  const profiles = buildProfiles(reference, consumption, averages);

  const forecasts: Partial<Record<ProfileKey, Forecast>> = {};
  const last = consumption.levels.at(-1);
  if (last !== undefined) {
    const options = {
      start: { day: last.day, liters: last.liters },
      refillsAfterStart: timedRefills(data.refills).filter((r) => r.day > last.day),
      now,
      horizonDays: FORECAST_HORIZON_DAYS,
      thresholdLiters,
      usableCapacity,
      leadDays: settings.orderLeadDays,
      lastPrice: refills.lastPrice,
    };
    for (const profile of profiles) {
      if (profile.available) {
        forecasts[profile.key] = simulate(profile, options);
      }
    }
  }
  const best = forecasts[bestProfile(profiles).key] ?? null;

  return {
    tank,
    tankErrors,
    capacity,
    usableCapacity,
    thresholdLiters,
    reference,
    consumption,
    years: yearRows(consumption.months),
    averages,
    seasons: seasonStats(averages, reference),
    refills,
    profiles,
    forecasts,
    best,
    last365: consumption.intervals.length > 0 ? consumptionBetween(consumption, now - 365, now) : null,
  };
}
