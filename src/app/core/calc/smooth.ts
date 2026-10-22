import { daysInMonth, yearMonthOf } from './time';

/** Longueur des mois d'une année non bissextile (positions des milieux de mois). */
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export type DailyProfile = (day: number) => number;

/**
 * Transforme 12 totaux mensuels en une valeur journalière continue : interpolation linéaire entre
 * les milieux de mois, au lieu d'un palier par mois (qui donne des cassures de pente au 1er de
 * chaque mois). Le total de chaque mois réel est conservé exactement.
 */
export function smoothMonthlyProfile(totals: readonly number[]): DailyProfile {
  const nodes = solveNodes(totals);
  const factors = new Map<string, number>();

  const factor = (year: number, month: number): number => {
    const key = `${year}-${month}`;
    let value = factors.get(key);
    if (value === undefined) {
      const days = daysInMonth(year, month);
      let sum = 0;
      for (let d = 0; d < days; d++) {
        sum += interpolate(nodes, year, month, d);
      }
      const target = totals[month] ?? 0;
      value = sum > 0 ? target / sum : 0;
      factors.set(key, value);
    }
    return value;
  };

  return (day) => {
    const { year, month } = yearMonthOf(day);
    const dayOfMonth = Math.floor(day) - firstDayOfMonth(year, month);
    const interpolated = interpolate(nodes, year, month, dayOfMonth);
    const f = factor(year, month);
    // Mois dont l'interpolation est nulle partout : répartition uniforme du total.
    return f > 0 || interpolated > 0 ? interpolated * f : (totals[month] ?? 0) / daysInMonth(year, month);
  };
}

/**
 * Valeurs aux milieux de mois telles que la moyenne de l'interpolation linéaire sur chaque mois
 * retombe sur la moyenne journalière du mois (système circulaire 1/8 · 3/4 · 1/8, résolu par Jacobi).
 */
function solveNodes(totals: readonly number[]): number[] {
  const averages = MONTH_LENGTHS.map((length, m) => (totals[m] ?? 0) / length);
  let nodes = averages.slice();
  for (let iteration = 0; iteration < 100; iteration++) {
    nodes = averages.map((average, m) => (average - (nodes[(m + 11) % 12]! + nodes[(m + 1) % 12]!) / 8) / 0.75);
  }
  return nodes.map((value) => Math.max(0, value));
}

/** Valeur interpolée pour le jour `dayOfMonth` (0 = premier jour), évaluée au milieu de la journée. */
function interpolate(nodes: number[], year: number, month: number, dayOfMonth: number): number {
  const length = daysInMonth(year, month);
  const position = dayOfMonth + 0.5;
  const middle = length / 2;
  if (position < middle) {
    const previous = (month + 11) % 12;
    const span = MONTH_LENGTHS[previous]! / 2 + middle;
    const t = (position + MONTH_LENGTHS[previous]! / 2) / span;
    return nodes[previous]! + (nodes[month]! - nodes[previous]!) * t;
  }
  const next = (month + 1) % 12;
  const span = middle + MONTH_LENGTHS[next]! / 2;
  const t = (position - middle) / span;
  return nodes[month]! + (nodes[next]! - nodes[month]!) * t;
}

function firstDayOfMonth(year: number, month: number): number {
  return Date.UTC(year, month, 1) / 86_400_000;
}
