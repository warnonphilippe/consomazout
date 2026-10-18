import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, effect, inject, input, viewChild } from '@angular/core';
import { Chart, registerables, type ChartConfiguration } from 'chart.js';
import 'chartjs-adapter-date-fns';
import { ThemeService } from '../../core/services/theme.service';
import { chartColors, type ChartColors } from './chart-colors';

Chart.register(...registerables);
Chart.defaults.font.family = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
Chart.defaults.font.size = 12;

export type ChartBuilder = (colors: ChartColors) => ChartConfiguration;

/**
 * Enveloppe Chart.js : reconstruit le graphique quand la configuration ou le thème change.
 * La configuration est une fonction des couleurs du thème courant.
 */
@Component({
  selector: 'app-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="chart-box" [style.height.px]="height()"><canvas #canvas></canvas></div>`,
  styles: `
    .chart-box {
      position: relative;
      width: 100%;
    }
  `,
})
export class ChartComponent implements OnDestroy {
  readonly build = input.required<ChartBuilder>();
  readonly height = input(320);

  private readonly theme = inject(ThemeService);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart: Chart | null = null;

  constructor() {
    effect(() => {
      const config = this.build()(chartColors(this.theme.effective()));
      const canvas = this.canvas().nativeElement;
      this.chart?.destroy();
      this.chart = new Chart(canvas, config);
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }
}
