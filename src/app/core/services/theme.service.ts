import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import type { ThemeMode } from '../models/app-data.model';
import { DataStore } from './data-store.service';
import { StorageService } from './storage.service';

export type EffectiveTheme = 'light' | 'dark';

/** Thème clair / sombre / système, appliqué via `data-theme` sur `<html>`. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly store = inject(DataStore);
  private readonly storage = inject(StorageService);
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media.matches);

  readonly mode = computed<ThemeMode>(() => this.store.settings().theme);
  readonly effective = computed<EffectiveTheme>(() => {
    const mode = this.mode();
    return mode === 'system' ? (this.systemDark() ? 'dark' : 'light') : mode;
  });

  constructor() {
    const listener = (event: MediaQueryListEvent): void => this.systemDark.set(event.matches);
    this.media.addEventListener('change', listener);
    inject(DestroyRef).onDestroy(() => this.media.removeEventListener('change', listener));

    effect(() => {
      document.documentElement.dataset['theme'] = this.effective();
    });
    effect(() => {
      void this.storage.setTheme(this.mode());
    });
  }

  setMode(mode: ThemeMode): void {
    this.store.updateSettings({ theme: mode });
  }

  /** Bascule rapide : système → opposé du système → … */
  toggle(): void {
    this.setMode(this.effective() === 'dark' ? 'light' : 'dark');
  }
}
