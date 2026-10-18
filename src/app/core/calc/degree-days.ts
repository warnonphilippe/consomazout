import { daysInMonth, yearMonthOf } from './time';

/**
 * Degrés-jours 15/15 normaux à Uccle (IRM), de janvier à décembre.
 * Source : IRM, « Statistiques climatiques des communes belges – Uccle (INS 21016) ».
 */
export const UCCLE_DEGREE_DAYS = [365.1, 321.6, 256.5, 162.8, 69.9, 22.7, 3.3, 4.0, 33.0, 122.2, 245.2, 346.8] as const;

export const UCCLE_DEGREE_DAYS_YEAR = UCCLE_DEGREE_DAYS.reduce((sum, value) => sum + value, 0);

/** Profil mensuel (litres) : l'eau chaude est répartie uniformément, le chauffage selon les degrés-jours. */
export function referenceMonthlyProfile(annualLiters: number, hotWaterLitersPerYear: number): number[] {
  const hotWater = Math.min(Math.max(hotWaterLitersPerYear, 0), annualLiters);
  const heating = annualLiters - hotWater;
  return UCCLE_DEGREE_DAYS.map((dd) => hotWater / 12 + (heating * dd) / UCCLE_DEGREE_DAYS_YEAR);
}

/**
 * Poids saisonnier d'un jour : part de la consommation annuelle attendue ce jour-là
 * (la somme sur une année vaut ~1). Sert à répartir la consommation mesurée entre deux relevés.
 */
export function seasonalDayWeight(day: number, hotWaterShare: number): number {
  const { year, month } = yearMonthOf(day);
  const share = Math.min(Math.max(hotWaterShare, 0), 1);
  const days = daysInMonth(year, month);
  return share / 365.25 + ((1 - share) * UCCLE_DEGREE_DAYS[month]!) / (UCCLE_DEGREE_DAYS_YEAR * days);
}

/** Somme des poids saisonniers sur [from, to] (numéros de jour fractionnaires). */
export function seasonalWeightBetween(from: number, to: number, hotWaterShare: number): number {
  let total = 0;
  forEachDaySlice(from, to, (day, fraction) => {
    total += fraction * seasonalDayWeight(day, hotWaterShare);
  });
  return total;
}

/** Découpe [from, to] en tranches journalières : `fraction` est la portion du jour couverte (0-1). */
export function forEachDaySlice(from: number, to: number, callback: (day: number, fraction: number) => void): void {
  if (!(to > from)) {
    return;
  }
  let day = Math.floor(from);
  while (day < to) {
    const start = Math.max(from, day);
    const end = Math.min(to, day + 1);
    if (end > start) {
      callback(day, end - start);
    }
    day++;
  }
}
