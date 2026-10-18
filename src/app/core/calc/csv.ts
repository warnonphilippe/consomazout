import type { ConsumptionAnalysis } from './consumption';
import type { Refill } from '../models/app-data.model';

/** CSV au format attendu par Excel en Belgique : séparateur « ; », virgule décimale. */
const SEP = ';';

const cell = (value: string | number): string => {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value).replace('.', ',') : '') : value;
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const line = (values: (string | number)[]): string => values.map(cell).join(SEP);

const round = (v: number, d = 1): number => Math.round(v * 10 ** d) / 10 ** d;

export function readingsCsv(analysis: ConsumptionAnalysis): string {
  const byTo = new Map(analysis.intervals.map((i) => [i.to.reading.id, i]));
  const rows = analysis.levels.map((level) => {
    const interval = byTo.get(level.reading.id);
    return line([
      level.reading.date.replace('T', ' '),
      level.reading.heightCm ?? '',
      round(level.liters, 0),
      level.reading.liters !== null ? 'jauge (litres)' : 'hauteur',
      interval ? round(interval.consumed, 0) : '',
      interval ? round(interval.litersPerDay) : '',
      interval?.anomaly ? 'incohérence' : '',
      level.reading.note,
    ]);
  });
  return [line(['Date', 'Hauteur (cm)', 'Contenu (L)', 'Mesure', 'Conso depuis précédent (L)', 'L/jour', 'Alerte', 'Note']), ...rows].join('\r\n');
}

export function refillsCsv(refills: Refill[]): string {
  const rows = refills
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => line([r.date.replace('T', ' '), r.liters, r.pricePerLiter, r.totalPrice, r.supplier, r.note]));
  return [line(['Date', 'Litres', 'Prix/L (€)', 'Total (€)', 'Fournisseur', 'Note']), ...rows].join('\r\n');
}

export function monthlyCsv(analysis: ConsumptionAnalysis): string {
  const rows = analysis.months.map((m) => line([m.key, round(m.liters, 0), m.complete ? 'oui' : 'non']));
  return [line(['Mois', 'Consommation (L)', 'Mois complet']), ...rows].join('\r\n');
}
