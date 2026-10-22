import { fr } from 'date-fns/locale';
import type { ChartConfiguration, ChartDataset, TooltipItem } from 'chart.js';
import type { FullAnalysis } from '../../core/calc/analysis';
import { levelSeries } from '../../core/calc/consumption';
import type { ProfileKey } from '../../core/calc/forecast';
import { dateToDayNumber, dayNumberToDate, MONTH_SHORT, toDayNumber, yearMonthOf } from '../../core/calc/time';
import type { Refill } from '../../core/models/app-data.model';
import { alpha, chartLegend, type ChartColors } from '../../shared/chart/chart-colors';
import { fmt } from '../../shared/format';

type XY = { x: number; y: number; refill?: Refill };

export const PROFILE_COLOR: Record<ProfileKey, keyof ChartColors> = {
  reference: 'reference',
  adjusted: 'adjusted',
  history: 'history',
};

const ms = (day: number): number => dayNumberToDate(day).getTime();

export interface LevelChartOptions {
  readonly historyDays: number | null;
  readonly forecastDays: number;
  readonly profiles: ReadonlySet<ProfileKey>;
}

/** Évolution du contenu : relevés réels, pleins, projections par profil, seuil et capacité. */
export function levelChart(
  analysis: FullAnalysis,
  refills: Refill[],
  now: number,
  options: LevelChartOptions,
): (c: ChartColors) => ChartConfiguration {
  return (c) => {
    const levels = analysis.consumption?.levels ?? [];
    const firstDay = levels[0]?.day ?? now;
    const minDay = options.historyDays === null ? firstDay - 7 : Math.max(firstDay - 7, now - options.historyDays);
    const maxDay = now + options.forecastDays;
    const datasets: ChartDataset<'line' | 'scatter', XY[]>[] = [];

    // Contenu reconstitué : diminution selon la consommation, saut vertical à chaque livraison.
    const series = analysis.consumption ? levelSeries(analysis.consumption) : { points: [], refills: [] };
    datasets.push({
      type: 'line',
      label: 'Contenu de la cuve',
      data: series.points.map((p) => ({ x: ms(p.day), y: Math.round(p.liters) })),
      borderColor: c.real,
      backgroundColor: alpha(c.real, 0.12),
      fill: 'origin',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 0,
      tension: 0,
      order: 2,
    });
    datasets.push({
      type: 'scatter',
      label: 'Relevés',
      data: levels.map((l) => ({ x: ms(l.day), y: Math.round(l.liters) })),
      pointRadius: levels.length > 120 ? 2 : 3.5,
      pointHoverRadius: 6,
      backgroundColor: c.real,
      borderColor: c.surface,
      borderWidth: 1,
      order: 1,
    });

    // Pleins : marqueur au niveau atteint juste après la livraison.
    const marked = new Map(series.refills.map((m) => [m.refill.id, m.liters]));
    const lastReading = levels.at(-1);
    const refillPoints: XY[] = refills.flatMap((refill) => {
      const day = toDayNumber(refill.date);
      let y = marked.get(refill.id);
      if (y === undefined && lastReading && day > lastReading.day) {
        // Livraison postérieure au dernier relevé : niveau tiré de la prévision retenue.
        const atDay = analysis.best?.points.filter((p) => Math.abs(p.day - day) < 1e-6) ?? [];
        y = atDay.length > 0 ? Math.max(...atDay.map((p) => p.liters)) : undefined;
      }
      return y === undefined ? [] : [{ x: ms(day), y: Math.round(y), refill }];
    });
    datasets.push({
      type: 'scatter',
      label: 'Pleins',
      data: refillPoints,
      pointStyle: 'triangle',
      pointRadius: 7,
      pointHoverRadius: 9,
      backgroundColor: c.refill,
      borderColor: c.surface,
      borderWidth: 1.5,
      order: 0,
    });

    for (const key of ['history', 'adjusted', 'reference'] as const) {
      const forecast = analysis.forecasts[key];
      if (!forecast || !options.profiles.has(key)) {
        continue;
      }
      const color = c[PROFILE_COLOR[key]] as string;
      datasets.push({
        type: 'line',
        label: `Prévision · ${forecast.profile.label}`,
        data: forecast.points.filter((p) => p.day <= maxDay).map((p) => ({ x: ms(p.day), y: Math.round(p.liters) })),
        borderColor: color,
        backgroundColor: color,
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0,
        tension: 0,
        order: 2,
      });
    }

    if (analysis.thresholdLiters > 0) {
      datasets.push(horizontal(`Seuil d'alerte (${fmt.liters(analysis.thresholdLiters)})`, analysis.thresholdLiters, minDay, maxDay, c.threshold, [4, 4]));
    }
    if (analysis.usableCapacity > 0) {
      datasets.push(horizontal(`Remplissage max. (${fmt.liters(analysis.usableCapacity)})`, analysis.usableCapacity, minDay, maxDay, c.capacity, [2, 3]));
    }
    datasets.push({
      type: 'line',
      label: "Aujourd'hui",
      data: [
        { x: ms(now), y: 0 },
        { x: ms(now), y: Math.round(analysis.capacity) },
      ],
      borderColor: alpha(c.muted, 0.6),
      borderWidth: 1,
      pointRadius: 0,
      order: 3,
    });

    return {
      type: 'line',
      data: { datasets: datasets as ChartDataset<'line', XY[]>[] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { mode: 'nearest', intersect: false, axis: 'x' },
        plugins: {
          legend: chartLegend(c),
          tooltip: {
            callbacks: {
              title: (items: TooltipItem<'line'>[]) => (items[0] ? fmt.longDate(dateToDayNumber(new Date(items[0].parsed.x ?? 0))) : ''),
              label: (item: TooltipItem<'line'>) => {
                const raw = item.raw as XY;
                if (raw.refill) {
                  return ` Plein : ${fmt.liters(raw.refill.liters)} à ${fmt.price(raw.refill.pricePerLiter)} (${fmt.euro(raw.refill.totalPrice)})`;
                }
                return ` ${item.dataset.label} : ${fmt.liters(item.parsed.y)}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            min: ms(minDay),
            max: ms(maxDay),
            adapters: { date: { locale: fr } },
            time: { unit: 'month', tooltipFormat: 'PPP', displayFormats: { month: 'MMM yy' } },
            grid: { color: c.grid },
            ticks: { color: c.muted, maxRotation: 0, autoSkipPadding: 16 },
          },
          y: {
            min: 0,
            suggestedMax: Math.ceil(analysis.capacity / 500) * 500,
            title: { display: true, text: 'Litres', color: c.muted },
            grid: { color: c.grid },
            ticks: { color: c.muted },
          },
        },
      },
    };
  };
}

/** Consommation mensuelle prévue pour les 12 prochains mois, par profil. */
export function monthlyForecastChart(analysis: FullAnalysis, now: number): (c: ChartColors) => ChartConfiguration {
  return (c) => {
    const { year, month } = yearMonthOf(now);
    const months = Array.from({ length: 12 }, (_, i) => (month + i) % 12);
    const labels = months.map((m, i) => `${MONTH_SHORT[m]} ${String(year + Math.floor((month + i) / 12)).slice(2)}`);
    const datasets: ChartDataset<'bar', number[]>[] = analysis.profiles
      .filter((p) => p.available)
      .map((p) => ({
        label: p.label,
        data: months.map((m) => Math.round(p.monthly[m] ?? 0)),
        backgroundColor: alpha(c[PROFILE_COLOR[p.key]] as string, 0.8),
        borderRadius: 4,
        maxBarThickness: 22,
      }));
    return {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: chartLegend(c),
          tooltip: { callbacks: { label: (item) => ` ${item.dataset.label} : ${fmt.liters(item.parsed.y)}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: c.muted } },
          y: { title: { display: true, text: 'Litres / mois', color: c.muted }, grid: { color: c.grid }, ticks: { color: c.muted } },
        },
      },
    };
  };
}

function horizontal(label: string, y: number, from: number, to: number, color: string, dash: number[]): ChartDataset<'line', XY[]> {
  return {
    type: 'line',
    label,
    data: [
      { x: ms(from), y: Math.round(y) },
      { x: ms(to), y: Math.round(y) },
    ],
    borderColor: color,
    borderDash: dash,
    borderWidth: 1.5,
    pointRadius: 0,
    order: 3,
  };
}
