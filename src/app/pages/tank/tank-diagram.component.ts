import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { TankShape } from '../../core/models/app-data.model';

/** Schéma de la cuve indiquant les cotes à mesurer. */
@Component({
  selector: 'app-tank-diagram',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 260 180" width="100%" height="180" role="img" aria-label="Schéma des cotes de la cuve">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" class="dim-head" />
        </marker>
      </defs>
      @switch (shape()) {
        @case ('rectangular') {
          <path d="M60 50 L190 50 L220 30 L90 30 Z" class="face top" />
          <path d="M190 50 L220 30 L220 120 L190 140 Z" class="face side" />
          <rect x="60" y="50" width="130" height="90" class="face front" />
          <rect x="61" y="100" width="128" height="39" class="oil" />
          <line x1="60" y1="158" x2="190" y2="158" class="dim" marker-start="url(#arrow)" marker-end="url(#arrow)" />
          <text x="125" y="173" class="label">Longueur</text>
          <line x1="230" y1="122" x2="230" y2="35" class="dim" marker-start="url(#arrow)" marker-end="url(#arrow)" transform="translate(8 0)" />
          <text x="246" y="20" class="label" text-anchor="end">Largeur</text>
          <line x1="40" y1="50" x2="40" y2="140" class="dim" marker-start="url(#arrow)" marker-end="url(#arrow)" />
          <text x="30" y="98" class="label" transform="rotate(-90 30 98)">Hauteur</text>
        }
        @case ('verticalCylinder') {
          <path d="M80 35 L80 140 A50 12 0 0 0 180 140 L180 35" class="face front" />
          <ellipse cx="130" cy="35" rx="50" ry="12" class="face top" />
          <path d="M81 100 L81 140 A49 11 0 0 0 179 140 L179 100 A49 11 0 0 1 81 100" class="oil" />
          <line x1="80" y1="168" x2="180" y2="168" class="dim" marker-start="url(#arrow)" marker-end="url(#arrow)" />
          <text x="130" y="163" class="label">Diamètre</text>
          <line x1="205" y1="35" x2="205" y2="140" class="dim" marker-start="url(#arrow)" marker-end="url(#arrow)" />
          <text x="222" y="90" class="label" transform="rotate(-90 222 90)">Hauteur</text>
        }
        @case ('horizontalCylinder') {
          <path d="M70 40 L200 40 A22 50 0 0 1 200 140 L70 140" class="face front" />
          <ellipse cx="70" cy="90" rx="22" ry="50" class="face side" />
          <path d="M70 110 L200 110 A22 50 0 0 1 200 140 L70 140 A22 50 0 0 1 49 112 Z" class="oil" />
          <line x1="70" y1="160" x2="200" y2="160" class="dim" marker-start="url(#arrow)" marker-end="url(#arrow)" />
          <text x="135" y="175" class="label">Longueur</text>
          <line x1="30" y1="40" x2="30" y2="140" class="dim" marker-start="url(#arrow)" marker-end="url(#arrow)" />
          <text x="20" y="90" class="label" transform="rotate(-90 20 90)">Diamètre</text>
          <line x1="240" y1="110" x2="240" y2="140" class="dim oil-dim" marker-start="url(#arrow)" marker-end="url(#arrow)" />
          <text x="250" y="100" class="label oil-label" text-anchor="end">h</text>
        }
        @case ('table') {
          <rect x="60" y="25" width="140" height="130" rx="10" class="face front" />
          @for (y of [50, 75, 100, 125]; track y) {
            <line x1="60" [attr.y1]="y" x2="200" [attr.y2]="y" class="grid" />
            <text x="210" [attr.y]="y + 4" class="label" text-anchor="start">{{ (155 - y) * 10 }} L</text>
          }
          <rect x="61" y="95" width="138" height="59" rx="0" class="oil" />
          <line x1="40" y1="155" x2="40" y2="95" class="dim" marker-start="url(#arrow)" marker-end="url(#arrow)" />
          <text x="30" y="128" class="label" transform="rotate(-90 30 128)">Hauteur</text>
        }
      }
    </svg>
  `,
  styles: `
    .face {
      stroke: var(--border-strong);
      stroke-width: 1.5;
    }
    .front {
      fill: var(--surface-2);
    }
    .top {
      fill: var(--surface-hover);
    }
    .side {
      fill: var(--surface-hover);
    }
    .oil {
      fill: color-mix(in srgb, var(--oil-light) 55%, transparent);
    }
    .grid {
      stroke: var(--border);
      stroke-dasharray: 3 3;
    }
    .dim {
      stroke: var(--accent);
      stroke-width: 1.3;
    }
    .dim-head {
      fill: var(--accent);
    }
    .oil-dim {
      stroke: var(--warning);
    }
    .label {
      fill: var(--text-muted);
      font-size: 11px;
      font-weight: 600;
      text-anchor: middle;
    }
    .oil-label {
      fill: var(--warning-text);
    }
  `,
})
export class TankDiagramComponent {
  readonly shape = input.required<TankShape>();
}
