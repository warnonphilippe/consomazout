import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Jauge de cuve en SVG : remplissage proportionnel, couleur d'alerte sous le seuil. */
@Component({
  selector: 'app-tank-gauge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="'0 0 ' + w() + ' ' + h()" [attr.width]="w()" [attr.height]="h()" role="img"
      [attr.aria-label]="'Cuve remplie à ' + clamped().toFixed(0) + ' %'">
      <defs>
        <clipPath [attr.id]="clipId">
          <rect x="2" y="2" [attr.width]="w() - 4" [attr.height]="h() - 4" [attr.rx]="radius()" />
        </clipPath>
        <linearGradient [attr.id]="gradId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" [attr.stop-color]="alert() ? '#f87171' : '#fbbf24'" />
          <stop offset="1" [attr.stop-color]="alert() ? '#b91c1c' : '#b45309'" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" [attr.width]="w() - 4" [attr.height]="h() - 4" [attr.rx]="radius()" class="shell" />
      <g [attr.clip-path]="'url(#' + clipId + ')'">
        <rect x="0" [attr.y]="fillY()" [attr.width]="w()" [attr.height]="h()" [attr.fill]="'url(#' + gradId + ')'" />
        <path [attr.d]="wave()" [attr.fill]="alert() ? '#fca5a5' : '#fcd34d'" opacity="0.45" />
      </g>
      @if (thresholdPct() !== null && !compact()) {
        <line x1="2" [attr.x2]="w() - 2" [attr.y1]="thresholdY()" [attr.y2]="thresholdY()" class="threshold" />
      }
      <rect x="2" y="2" [attr.width]="w() - 4" [attr.height]="h() - 4" [attr.rx]="radius()" class="outline" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .shell {
      fill: var(--surface-2);
    }
    .outline {
      fill: none;
      stroke: var(--border-strong);
      stroke-width: 2;
    }
    .threshold {
      stroke: var(--danger);
      stroke-width: 1.5;
      stroke-dasharray: 4 3;
    }
  `,
})
export class TankGaugeComponent {
  private static nextId = 0;

  readonly pct = input.required<number>();
  readonly alert = input(false);
  readonly compact = input(false);
  readonly thresholdPct = input<number | null>(null);

  protected readonly clipId = `gauge-clip-${TankGaugeComponent.nextId}`;
  protected readonly gradId = `gauge-grad-${TankGaugeComponent.nextId++}`;

  protected readonly w = computed(() => (this.compact() ? 34 : 76));
  protected readonly h = computed(() => (this.compact() ? 46 : 104));
  protected readonly radius = computed(() => (this.compact() ? 7 : 14));
  protected readonly clamped = computed(() => Math.min(100, Math.max(0, this.pct())));
  protected readonly fillY = computed(() => 2 + (this.h() - 4) * (1 - this.clamped() / 100));
  protected readonly thresholdY = computed(() => 2 + (this.h() - 4) * (1 - (this.thresholdPct() ?? 0) / 100));

  /** Petite vague à la surface du liquide. */
  protected readonly wave = computed(() => {
    const y = this.fillY();
    const w = this.w();
    const a = this.compact() ? 1.5 : 2.5;
    return `M0 ${y} Q ${w / 4} ${y - a} ${w / 2} ${y} T ${w} ${y} V ${y + a * 2} H 0 Z`;
  });
}
