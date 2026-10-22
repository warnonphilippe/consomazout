import { fr } from 'date-fns/locale';
import { Interaction, type ActiveElement, type ChartConfiguration, type ChartDataset, type InteractionModeFunction, type TooltipItem } from 'chart.js';
import { getRelativePosition } from 'chart.js/helpers';
import type { FullAnalysis } from '../../core/calc/analysis';
import { levelSeries } from '../../core/calc/consumption';
import { heightForVolume, supportsHeight } from '../../core/calc/tank-volume';
import type { ProfileKey } from '../../core/calc/forecast';
import { dateToDayNumber, dayNumberToDate, MONTH_SHORT, toDayNumber, yearMonthOf } from '../../core/calc/time';
import type { Refill } from '../../core/models/app-data.model';
import { alpha, chartLegend, type ChartColors } from '../../shared/chart/chart-colors';
import { fmt } from '../../shared/format';

/** `heightCm` : hauteur réellement mesurée (relevé encodé en cm). */
type XY = { x: number; y: number; refill?: Refill; heightCm?: number };

const TODAY_LABEL = "Aujourd'hui";

declare module 'chart.js' {
  interface InteractionModeMap {
    markersFirst: InteractionModeFunction;
  }
}

/** Rayon (px) dans lequel un marqueur (relevé, plein) l'emporte sur la courbe. */
const MARKER_HIT_RADIUS = 12;

/**
 * Survol : un marqueur (relevé ou plein, jeux de type « scatter ») proche du pointeur est prioritaire ;
 * sinon, le point le plus proche horizontalement. Sans cela, la courbe journalière, plus dense,
 * masquerait les informations du plein.
 */
Interaction.modes.markersFirst = (chart, event, options, useFinalPosition) => {
  const position = getRelativePosition(event, chart);
  const markers: (ActiveElement & { distance: number })[] = [];
  chart.data.datasets.forEach((dataset, datasetIndex) => {
    if (dataset.type !== 'scatter' || !chart.isDatasetVisible(datasetIndex)) {
      return;
    }
    chart.getDatasetMeta(datasetIndex).data.forEach((element, index) => {
      const { x, y } = element.getProps(['x', 'y'], useFinalPosition);
      const distance = Math.hypot(x - position.x, y - position.y);
      if (distance <= MARKER_HIT_RADIUS) {
        markers.push({ element, datasetIndex, index, distance });
      }
    });
  });
  if (markers.length > 0) {
    const closest = Math.min(...markers.map((m) => m.distance));
    return markers.filter((m) => m.distance === closest);
  }
  return Interaction.modes.nearest(chart, event, { ...options, axis: 'x', intersect: false }, useFinalPosition);
};

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
      data: levels.map((l) => ({
        x: ms(l.day),
        y: Math.round(l.liters),
        ...(l.reading.heightCm !== null ? { heightCm: l.reading.heightCm } : {}),
      })),
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
      label: TODAY_LABEL,
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
        interaction: { mode: 'markersFirst', intersect: false },
        plugins: {
          legend: chartLegend(c),
          tooltip: {
            filter: (item: TooltipItem<'line'>) => item.dataset.label !== TODAY_LABEL,
            callbacks: {
              title: (items: TooltipItem<'line'>[]) => (items[0] ? fmt.longDate(dateToDayNumber(new Date(items[0].parsed.x ?? 0))) : ''),
              label: (item: TooltipItem<'line'>) => {
                const raw = item.raw as XY;
                const content = withHeight(analysis, item.parsed.y ?? 0, raw.heightCm);
                if (raw.refill) {
                  return [
                    raw.refill.pricePerLiter > 0
                      ? ` Plein : ${fmt.liters(raw.refill.liters)} à ${fmt.price(raw.refill.pricePerLiter)} (${fmt.euro(raw.refill.totalPrice)})`
                      : ` Plein : ${fmt.liters(raw.refill.liters)} (prix non encodé)`,
                    ` Après livraison : ${content}`,
                  ];
                }
                return ` ${item.dataset.label} : ${content}`;
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

/**
 * « 1 248 L · 65,0 cm » : hauteur mesurée si connue, sinon hauteur correspondant au volume
 * (« ≈ »), calculée selon la cuve. Rien pour une cuve à jauge, qui n'a pas de dimensions.
 */
function withHeight(analysis: FullAnalysis, liters: number, measuredCm?: number): string {
  const tank = analysis.tank;
  if (measuredCm !== undefined) {
    return `${fmt.liters(liters)} · ${fmt.number(measuredCm, 1)} cm`;
  }
  if (!tank || !supportsHeight(tank)) {
    return fmt.liters(liters);
  }
  return `${fmt.liters(liters)} · ≈ ${fmt.number(heightForVolume(tank, liters), 1)} cm`;
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
