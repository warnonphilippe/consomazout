import type { FullAnalysis } from '../calc/analysis';
import { dayNumberToDate, toLocalIso } from '../calc/time';
import type { AppData } from '../models/app-data.model';
import { MAZOUT_KWH_PER_LITER, SUMMARY_SCHEMA, type MazoutSummary } from './household-summary';

/** 12 derniers mois considérés comme représentatifs d'une année. */
const MIN_COVERED_DAYS = 300;
const MONTHS = 24;

const r0 = (v: number): number => Math.round(v);
const kwh = (liters: number): number => Math.round(liters * MAZOUT_KWH_PER_LITER);
const day = (d: number | null): string | null => (d === null ? null : toLocalIso(dayNumberToDate(d)).slice(0, 10));

/** Résumé de ConsoMazout publié pour ConsoElec et le serveur MCP ; `null` tant qu'il n'y a aucun relevé. */
export function buildMazoutSummary(data: AppData, analysis: FullAnalysis, generatedAt: Date): MazoutSummary | null {
  const consumption = analysis.consumption;
  if (consumption === null || consumption.levels.length === 0) {
    return null;
  }
  const { settings } = data;
  const best = analysis.best;
  const last = analysis.last365;

  let liters: number;
  let source: MazoutSummary['estimationAnnuelle']['source'];
  let detail: string;
  if (best) {
    liters = best.profile.monthly.reduce((s, v) => s + v, 0);
    source = 'prevision';
    detail = `prévision « ${best.profile.label} »`;
  } else if (last && last.coveredDays >= MIN_COVERED_DAYS) {
    liters = last.liters;
    source = 'derniers12Mois';
    detail = `${r0(last.coveredDays)} jours mesurés`;
  } else {
    liters = settings.referenceAnnualLiters;
    source = 'reference';
    detail = 'consommation de référence';
  }
  const price = analysis.refills.lastPrice ?? analysis.refills.averagePrice;

  return {
    schema: SUMMARY_SCHEMA,
    application: 'consomazout',
    genereLe: generatedAt.toISOString(),
    estimationAnnuelle: {
      litres: r0(liters),
      equivalentKwh: kwh(liters),
      source,
      detail,
      coutEstime: price === null ? null : r0(liters * price),
    },
    derniers12Mois: last
      ? { litres: r0(last.liters), equivalentKwh: kwh(last.liters), joursCouverts: r0(last.coveredDays) }
      : null,
    consommationAnnuelle: analysis.years.map((y) => ({ annee: y.year, litres: r0(y.total), complete: y.complete })),
    consommationMensuelle: consumption.months
      .slice(-MONTHS)
      .map((m) => ({ mois: m.key, litres: r0(m.liters), complet: m.complete })),
    previsionParMoisLitres: best ? best.profile.monthly.map(r0) : null,
    eauChaudeLitresParAn: settings.hotWaterLitersPerYear,
    referenceLitresParAn: settings.referenceAnnualLiters,
    cuve: best
      ? {
          contenuEstimeLitres: r0(best.currentLiters),
          capaciteLitres: r0(analysis.capacity),
          commanderAvantLe: day(best.orderDay),
        }
      : null,
    prixParLitre: { moyen: analysis.refills.averagePrice, dernier: analysis.refills.lastPrice },
    dernierReleve: consumption.levels.at(-1)?.reading.date ?? null,
  };
}
