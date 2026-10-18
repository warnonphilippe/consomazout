import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { analyze } from '../calc/analysis';
import { buildDemoData } from '../calc/demo-data';
import { heightForVolume, supportsHeight } from '../calc/tank-volume';
import { dateToDayNumber } from '../calc/time';
import {
  emptyData,
  measureFields,
  type AppData,
  type Measure,
  type Reading,
  type Refill,
  type Settings,
  type Tank,
} from '../models/app-data.model';
import { mergeData, type MergeReport, type MergeResult } from '../models/merge';
import { newId, normalizeData } from '../models/normalize';
import { StorageService } from './storage.service';
import { ToastService } from './toast.service';

const SAVE_DELAY_MS = 300;

/** État de l'application (signals) et persistance automatique. */
@Injectable({ providedIn: 'root' })
export class DataStore {
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);

  private readonly state = signal<AppData>(emptyData());
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  readonly data = this.state.asReadonly();
  readonly loaded = signal(false);
  readonly filePath = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  /** Instant présent (numéro de jour), rafraîchi chaque minute. */
  readonly now = signal(dateToDayNumber(new Date()));

  readonly tank = computed(() => this.state().tank);
  readonly settings = computed(() => this.state().settings);
  readonly readings = computed(() => this.state().readings.slice().sort((a, b) => b.date.localeCompare(a.date)));
  readonly refills = computed(() => this.state().refills.slice().sort((a, b) => b.date.localeCompare(a.date)));
  readonly analysis = computed(() => analyze(this.state(), this.now()));

  constructor() {
    const timer = setInterval(() => this.now.set(dateToDayNumber(new Date())), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  async init(): Promise<void> {
    try {
      const stored = await this.storage.load();
      this.filePath.set(stored.path);
      if (stored.content !== null) {
        this.state.set(normalizeData(JSON.parse(stored.content)));
      }
      if (stored.recoveredFromBackup) {
        this.toast.show('Le fichier de données était illisible : la copie de secours a été restaurée.', 'warning');
      }
    } catch (error) {
      this.toast.show(`Impossible de lire les données : ${message(error)}`, 'error');
    } finally {
      this.loaded.set(true);
    }
  }

  setTank(tank: Tank): void {
    this.update((d) => ({ ...d, tank }));
  }

  updateSettings(patch: Partial<Settings>): void {
    this.update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  }

  saveReading(reading: Omit<Reading, 'id'> & { id?: string }): void {
    const entry: Reading = { ...reading, id: reading.id ?? newId() };
    this.update((d) => ({ ...d, readings: upsert(d.readings, entry) }));
  }

  deleteReading(id: string): void {
    this.update((d) => ({ ...d, readings: d.readings.filter((r) => r.id !== id) }));
  }

  /** Enregistre un plein ; si la mesure après le plein est fournie (hauteur ou litres), un relevé est créé à la même date. */
  saveRefill(refill: Omit<Refill, 'id'> & { id?: string }, after: Measure | null): void {
    const entry: Refill = { ...refill, id: refill.id ?? newId() };
    this.update((d) => {
      let readings = d.readings;
      if (after !== null) {
        readings = upsert(readings, {
          id: newId(),
          date: entry.date,
          ...measureFields(after),
          note: 'Relevé après plein',
        });
      }
      return { ...d, refills: upsert(d.refills, entry), readings };
    });
  }

  deleteRefill(id: string): void {
    this.update((d) => ({ ...d, refills: d.refills.filter((r) => r.id !== id) }));
  }

  /** Contenu estimé aujourd'hui, en litres (pour pré-remplir les formulaires). */
  estimatedLitersNow(): number | null {
    return this.analysis().best?.currentLiters ?? null;
  }

  /** Hauteur estimée de mazout aujourd'hui ; `null` pour une cuve à jauge (sans dimensions). */
  estimatedHeightNow(): number | null {
    const tank = this.tank();
    const liters = this.estimatedLitersNow();
    return tank && supportsHeight(tank) && liters !== null ? heightForVolume(tank, liters) : null;
  }

  /** Lit et valide un fichier exporté (lève une erreur s'il n'est pas reconnu). */
  parseImport(content: string): AppData {
    return normalizeData(JSON.parse(content));
  }

  /** Aperçu de la fusion d'un fichier importé avec les données locales, sans rien modifier. */
  previewMerge(incoming: AppData): MergeResult {
    return mergeData(this.state(), incoming);
  }

  /** Ajoute les relevés et pleins absents du fichier ; les données locales restent intactes. */
  mergeImport(incoming: AppData): MergeReport {
    const result = mergeData(this.state(), incoming);
    this.update(() => result.data);
    return result.report;
  }

  /** Remplace toutes les données par celles du fichier (le thème local est conservé). */
  replaceWithImport(incoming: AppData): void {
    this.update((d) => ({ ...incoming, settings: { ...incoming.settings, theme: d.settings.theme } }));
  }

  loadDemo(): void {
    const demo = buildDemoData(new Date());
    this.update((d) => ({ ...demo, settings: { ...demo.settings, theme: d.settings.theme } }));
  }

  reset(): void {
    this.update((d) => ({ ...emptyData(), settings: { ...emptyData().settings, theme: d.settings.theme } }));
  }

  exportJson(): string {
    return JSON.stringify(this.state(), null, 2);
  }

  private update(change: (data: AppData) => AppData): void {
    this.state.update(change);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  async flush(): Promise<void> {
    this.saveTimer = null;
    this.saving.set(true);
    try {
      await this.storage.save(this.exportJson());
      this.saveError.set(null);
    } catch (error) {
      this.saveError.set(message(error));
      this.toast.show(`Échec de l'enregistrement : ${message(error)}`, 'error');
    } finally {
      this.saving.set(false);
    }
  }
}

function upsert<T extends { id: string }>(list: T[], entry: T): T[] {
  const index = list.findIndex((item) => item.id === entry.id);
  return index === -1 ? [...list, entry] : list.map((item, i) => (i === index ? entry : item));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
