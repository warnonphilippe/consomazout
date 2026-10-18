import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ConfirmService } from './core/services/confirm.service';
import { DataStore } from './core/services/data-store.service';
import { ThemeService } from './core/services/theme.service';
import { ToastService } from './core/services/toast.service';
import type { ThemeMode } from './core/models/app-data.model';
import { fmt } from './shared/format';
import { IconComponent, type IconName } from './shared/icon.component';
import { TankGaugeComponent } from './shared/tank-gauge.component';

interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly icon: IconName;
  readonly exact?: boolean;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, TankGaugeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly store = inject(DataStore);
  protected readonly theme = inject(ThemeService);
  protected readonly toasts = inject(ToastService);
  protected readonly confirm = inject(ConfirmService);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('confirmDialog');

  protected readonly nav: NavItem[] = [
    { path: '/', label: 'Tableau de bord', icon: 'gauge', exact: true },
    { path: '/releves', label: 'Relevés', icon: 'ruler' },
    { path: '/pleins', label: 'Pleins', icon: 'truck' },
    { path: '/statistiques', label: 'Statistiques', icon: 'chart' },
    { path: '/cuve', label: 'Cuve', icon: 'tank' },
  ];

  protected readonly secondaryNav: NavItem[] = [
    { path: '/reglages', label: 'Réglages', icon: 'settings' },
    { path: '/aide', label: 'Aide', icon: 'help' },
  ];

  protected readonly themeModes: { mode: ThemeMode; icon: IconName; label: string }[] = [
    { mode: 'light', icon: 'sun', label: 'Clair' },
    { mode: 'dark', icon: 'moon', label: 'Sombre' },
    { mode: 'system', icon: 'monitor', label: 'Système' },
  ];

  /** Mini-jauge de la barre latérale. */
  protected readonly level = computed(() => {
    const analysis = this.store.analysis();
    const best = analysis.best;
    if (!best || analysis.capacity <= 0) {
      return null;
    }
    return {
      liters: best.currentLiters,
      pct: (best.currentLiters / analysis.capacity) * 100,
      label: fmt.liters(best.currentLiters),
      alert: best.currentLiters <= analysis.thresholdLiters,
    };
  });

  constructor() {
    effect(() => {
      const dialog = this.dialog()?.nativeElement;
      if (!dialog) {
        return;
      }
      if (this.confirm.pending() && !dialog.open) {
        dialog.showModal();
      } else if (!this.confirm.pending() && dialog.open) {
        dialog.close();
      }
    });
  }
}
