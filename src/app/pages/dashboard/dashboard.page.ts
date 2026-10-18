import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { consumptionBetween } from '../../core/calc/consumption';
import { dailyRate, type ProfileKey } from '../../core/calc/forecast';
import { DataStore } from '../../core/services/data-store.service';
import { ToastService } from '../../core/services/toast.service';
import { ChartComponent } from '../../shared/chart/chart.component';
import { chartColors } from '../../shared/chart/chart-colors';
import { FORMAT_PIPES } from '../../shared/format';
import { IconComponent } from '../../shared/icon.component';
import { TankGaugeComponent } from '../../shared/tank-gauge.component';
import { ThemeService } from '../../core/services/theme.service';
import { PROFILE_COLOR, levelChart, monthlyForecastChart } from './dashboard-charts';

@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, IconComponent, TankGaugeComponent, ChartComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.css',
})
export default class DashboardPage {
  protected readonly store = inject(DataStore);
  private readonly theme = inject(ThemeService);
  private readonly toast = inject(ToastService);

  protected readonly analysis = this.store.analysis;
  protected readonly now = this.store.now;

  protected readonly historyOptions = [
    { label: '6 mois', days: 183 },
    { label: '1 an', days: 365 },
    { label: '2 ans', days: 730 },
    { label: 'Tout', days: null },
  ] as const;
  protected readonly forecastOptions = [
    { label: '6 mois', days: 183 },
    { label: '12 mois', days: 365 },
    { label: '18 mois', days: 540 },
  ] as const;

  protected readonly historyDays = signal<number | null>(365);
  protected readonly forecastDays = signal(365);
  protected readonly shownProfiles = signal<ReadonlySet<ProfileKey>>(new Set(['reference', 'adjusted', 'history']));

  protected readonly colors = computed(() => chartColors(this.theme.effective()));

  protected readonly hasReadings = computed(() => (this.analysis().consumption?.levels.length ?? 0) > 0);
  protected readonly lastLevel = computed(() => this.analysis().consumption?.levels.at(-1) ?? null);

  protected readonly current = computed(() => {
    const a = this.analysis();
    const best = a.best;
    if (!best || a.capacity <= 0) {
      return null;
    }
    return {
      liters: best.currentLiters,
      pct: (best.currentLiters / a.capacity) * 100,
      alert: best.currentLiters <= a.thresholdLiters,
      thresholdPct: (a.thresholdLiters / a.capacity) * 100,
      free: Math.max(0, a.usableCapacity - best.currentLiters),
    };
  });

  /** Consommation journalière : attendue ce mois-ci (profil retenu) et observée récemment. */
  protected readonly rate = computed(() => {
    const a = this.analysis();
    const best = a.best;
    const now = this.now();
    const expected = best ? dailyRate(best.profile, now) : null;
    const recent = a.consumption ? consumptionBetween(a.consumption, now - 30, now) : null;
    return {
      expected,
      recent: recent && recent.coveredDays >= 5 ? recent.liters / recent.coveredDays : null,
      recentDays: recent?.coveredDays ?? 0,
    };
  });

  protected readonly yearly = computed(() => {
    const a = this.analysis();
    const last = a.last365;
    const price = a.refills.averagePrice ?? a.refills.lastPrice;
    if (!last || last.coveredDays < 1) {
      return null;
    }
    return {
      liters: last.liters,
      coveredDays: last.coveredDays,
      cost: price !== null ? last.liters * price : null,
    };
  });

  protected readonly order = computed(() => {
    const best = this.analysis().best;
    if (!best) {
      return null;
    }
    const now = this.now();
    if (best.orderDay === null) {
      return { kind: 'later' as const, best };
    }
    if (best.alertDay !== null && best.alertDay <= now) {
      return { kind: 'below' as const, best };
    }
    if (best.orderDay <= now) {
      return { kind: 'now' as const, best };
    }
    return { kind: 'planned' as const, best, inDays: Math.round(best.orderDay - now) };
  });

  protected readonly forecastRows = computed(() =>
    this.analysis().profiles.map((profile) => ({
      profile,
      forecast: this.analysis().forecasts[profile.key] ?? null,
      color: this.colors()[PROFILE_COLOR[profile.key]] as string,
      isBest: this.analysis().best?.profile.key === profile.key,
    })),
  );

  protected readonly levelChart = computed(() =>
    levelChart(this.analysis(), this.store.data().refills, this.now(), {
      historyDays: this.historyDays(),
      forecastDays: this.forecastDays(),
      profiles: this.shownProfiles(),
    }),
  );

  protected readonly monthlyChart = computed(() => monthlyForecastChart(this.analysis(), this.now()));

  protected toggleProfile(key: ProfileKey): void {
    this.shownProfiles.update((set) => {
      const next = new Set(set);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  protected loadDemo(): void {
    this.store.loadDemo();
    this.toast.show('Données de démonstration chargées : explorez librement, puis réinitialisez dans les Réglages.', 'info');
  }
}
