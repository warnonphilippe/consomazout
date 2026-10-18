import { fr } from 'date-fns/locale';
import type { ChartConfiguration, ChartDataset } from 'chart.js';
import type { FullAnalysis } from '../../core/calc/analysis';
import { dayNumberToDate, MONTH_SHORT, toDayNumber } from '../../core/calc/time';
import type { Refill } from '../../core/models/app-data.model';
import { alpha, chartLegend, type ChartColors } from '../../shared/chart/chart-colors';
import { fmt } from '../../shared/format';

const axisMonths = MONTH_SHORT.map((m) => m.replace('.', ''));

/** Barres mensuelles de l'année choisie, avec la moyenne observée et la référence belge. */
export function yearChart(analysis: FullAnalysis, year: number): (c: ChartColors) => ChartConfiguration {
  return (c) => {
    const row = analysis.years.find((y) => y.year === year);
    const datasets: ChartDataset<'bar' | 'line', (number | null)[]>[] = [
      {
        type: 'bar',
        label: `Consommation ${year}`,
        data: (row?.months ?? []).map((cell) => (cell ? Math.round(cell.liters) : null)),
        backgroundColor: (row?.months ?? []).map((cell) => (cell?.complete ? alpha(c.real, 0.85) : alpha(c.real, 0.35))),
        borderRadius: 5,
        maxBarThickness: 40,
        order: 2,
      },
      {
        type: 'line',
        label: 'Moyenne observée',
        data: analysis.averages.map((a) => (a.average !== null ? Math.round(a.average) : null)),
        borderColor: c.history,
        backgroundColor: c.history,
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.3,
        spanGaps: true,
        order: 1,
      },
      {
        type: 'line',
        label: 'Référence belge',
        data: analysis.reference.map((v) => Math.round(v)),
        borderColor: c.reference,
        backgroundColor: c.reference,
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        order: 0,
      },
    ];
    return {
      type: 'bar',
      data: { labels: [...axisMonths], datasets: datasets as ChartDataset<'bar', (number | null)[]>[] },
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

/** Une courbe par année, mois par mois, pour comparer les hivers. */
export function yearsComparisonChart(analysis: FullAnalysis): (c: ChartColors) => ChartConfiguration {
  return (c) => ({
    type: 'line',
    data: {
      labels: [...axisMonths],
      datasets: analysis.years.map((row, i) => {
        const color = c.years[i % c.years.length]!;
        return {
          label: String(row.year),
          data: row.months.map((cell) => (cell ? Math.round(cell.liters) : null)),
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3,
        };
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: chartLegend(c),
        tooltip: { callbacks: { label: (item) => ` ${item.dataset.label} : ${fmt.liters(item.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: c.muted } },
        y: { min: 0, grid: { color: c.grid }, ticks: { color: c.muted } },
      },
    },
  });
}

/** Évolution du prix au litre payé à chaque plein. */
export function priceChart(refills: Refill[]): (c: ChartColors) => ChartConfiguration {
  return (c) => {
    const points = refills
      .filter((r) => r.pricePerLiter > 0)
      .map((r) => ({ x: dayNumberToDate(toDayNumber(r.date)).getTime(), y: r.pricePerLiter, refill: r }))
      .sort((a, b) => a.x - b.x);
    return {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Prix au litre',
            data: points,
            borderColor: c.refill,
            backgroundColor: c.refill,
            borderWidth: 2,
            pointRadius: 4,
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => {
                const r = (item.raw as { refill: Refill }).refill;
                return ` ${fmt.price(r.pricePerLiter)} · ${fmt.liters(r.liters)} · ${fmt.euro(r.totalPrice)}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            adapters: { date: { locale: fr } },
            time: { unit: 'month', tooltipFormat: 'PPP', displayFormats: { month: 'MMM yy' } },
            grid: { color: c.grid },
            ticks: { color: c.muted, maxRotation: 0, autoSkipPadding: 16 },
          },
          y: {
            title: { display: true, text: '€ / L', color: c.muted },
            grid: { color: c.grid },
            ticks: { color: c.muted, callback: (v) => Number(v).toFixed(2) },
          },
        },
      },
    };
  };
}
