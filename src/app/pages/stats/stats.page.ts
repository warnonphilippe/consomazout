import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MONTH_LABELS, MONTH_SHORT } from '../../core/calc/time';
import type { SeasonKey } from '../../core/calc/stats';
import { DataStore } from '../../core/services/data-store.service';
import { ChartComponent } from '../../shared/chart/chart.component';
import { FORMAT_PIPES } from '../../shared/format';
import { IconComponent, type IconName } from '../../shared/icon.component';
import { priceChart, yearChart, yearsComparisonChart } from './stats-charts';

const SEASON_ICON: Record<SeasonKey, IconName> = {
  winter: 'flame',
  spring: 'sparkles',
  summer: 'sun',
  autumn: 'droplet',
};

@Component({
  selector: 'app-stats-page',
  imports: [RouterLink, IconComponent, ChartComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stats.page.html',
  styleUrl: './stats.page.css',
})
export default class StatsPage {
  private readonly store = inject(DataStore);

  protected readonly analysis = this.store.analysis;
  protected readonly monthShort = MONTH_SHORT;
  protected readonly monthLabels = MONTH_LABELS;
  protected readonly seasonIcon = SEASON_ICON;

  protected readonly years = computed(() => this.analysis().years);
  protected readonly selectedYear = linkedSignal(() => this.years().at(-1)?.year ?? new Date().getFullYear());

  protected readonly averagesTotal = computed(() => {
    const averages = this.analysis().averages;
    return averages.every((a) => a.average !== null) ? averages.reduce((s, a) => s + a.average!, 0) : null;
  });

  protected readonly referenceTotal = computed(() => this.analysis().reference.reduce((s, v) => s + v, 0));

  /** Totaux annuels, avec la dépense des pleins de l'année. */
  protected readonly yearlyTotals = computed(() =>
    this.years().map((row) => {
      const refills = this.store.data().refills.filter((r) => r.date.startsWith(String(row.year)));
      return {
        year: row.year,
        liters: row.total,
        complete: row.complete,
        months: row.months.filter((m) => m !== null).length,
        delivered: refills.reduce((s, r) => s + r.liters, 0),
        cost: refills.reduce((s, r) => s + r.totalPrice, 0),
      };
    }),
  );

  protected readonly yearChart = computed(() => yearChart(this.analysis(), this.selectedYear()));
  protected readonly comparisonChart = computed(() => yearsComparisonChart(this.analysis()));
  protected readonly priceChart = computed(() => priceChart(this.store.data().refills));
  protected readonly hasPrices = computed(() => this.store.data().refills.some((r) => r.pricePerLiter > 0));

  protected ratio(value: number | null, reference: number): number | null {
    return value !== null && reference > 0 ? (value / reference) * 100 : null;
  }
}
