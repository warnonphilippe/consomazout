import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { monthlyCsv, readingsCsv, refillsCsv } from '../../core/calc/csv';
import { UCCLE_DEGREE_DAYS } from '../../core/calc/degree-days';
import { MONTH_SHORT } from '../../core/calc/time';
import { REFERENCE_PRESETS, type ReferencePreset, type ThemeMode } from '../../core/models/app-data.model';
import { ConfirmService } from '../../core/services/confirm.service';
import { DataStore } from '../../core/services/data-store.service';
import { StorageService } from '../../core/services/storage.service';
import { ThemeService } from '../../core/services/theme.service';
import { ToastService } from '../../core/services/toast.service';
import { FORMAT_PIPES } from '../../shared/format';
import { IconComponent, type IconName } from '../../shared/icon.component';

@Component({
  selector: 'app-settings-page',
  imports: [IconComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.css',
})
export default class SettingsPage {
  protected readonly store = inject(DataStore);
  protected readonly storage = inject(StorageService);
  protected readonly theme = inject(ThemeService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly settings = this.store.settings;
  protected readonly monthShort = MONTH_SHORT;
  protected readonly degreeDays = UCCLE_DEGREE_DAYS;

  protected readonly presets = (Object.keys(REFERENCE_PRESETS) as Exclude<ReferencePreset, 'custom'>[]).map((key) => ({
    key,
    ...REFERENCE_PRESETS[key],
  }));

  protected readonly themeModes: { mode: ThemeMode; icon: IconName; label: string }[] = [
    { mode: 'light', icon: 'sun', label: 'Clair' },
    { mode: 'dark', icon: 'moon', label: 'Sombre' },
    { mode: 'system', icon: 'monitor', label: 'Système' },
  ];

  protected readonly reference = computed(() => this.store.analysis().reference);
  protected readonly referenceMax = computed(() => Math.max(...this.reference()));
  protected readonly hotWaterPct = computed(() => {
    const s = this.settings();
    return s.referenceAnnualLiters > 0 ? (s.hotWaterLitersPerYear / s.referenceAnnualLiters) * 100 : 0;
  });
  protected readonly thresholdLiters = computed(() => this.store.analysis().thresholdLiters);
  protected readonly counts = computed(() => ({
    readings: this.store.data().readings.length,
    refills: this.store.data().refills.length,
  }));

  protected selectPreset(key: Exclude<ReferencePreset, 'custom'>): void {
    this.store.updateSettings({ referencePreset: key, referenceAnnualLiters: REFERENCE_PRESETS[key].liters });
  }

  protected setNumber(
    field: 'referenceAnnualLiters' | 'hotWaterLitersPerYear' | 'alertThresholdPct' | 'orderLeadDays',
    event: Event,
    min: number,
    max: number,
  ): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (!Number.isFinite(value)) {
      return;
    }
    const clamped = Math.min(max, Math.max(min, value));
    this.store.updateSettings(
      field === 'referenceAnnualLiters' ? { referenceAnnualLiters: clamped, referencePreset: 'custom' } : { [field]: clamped },
    );
  }

  protected async exportJson(): Promise<void> {
    const name = `consomazout-${new Date().toISOString().slice(0, 10)}.json`;
    const path = await this.storage.exportFile(this.store.exportJson(), name, 'json');
    if (path) {
      this.toast.show(path === 'download' ? 'Sauvegarde téléchargée.' : `Sauvegarde enregistrée : ${path}`);
    }
  }

  protected async exportCsv(kind: 'readings' | 'refills' | 'months'): Promise<void> {
    const consumption = this.store.analysis().consumption;
    const content =
      kind === 'refills'
        ? refillsCsv(this.store.data().refills)
        : consumption
          ? kind === 'readings'
            ? readingsCsv(consumption)
            : monthlyCsv(consumption)
          : null;
    if (content === null) {
      this.toast.show('Configurez la cuve avant d’exporter les relevés.', 'warning');
      return;
    }
    const names = { readings: 'releves', refills: 'pleins', months: 'consommation-mensuelle' };
    const path = await this.storage.exportFile(content, `consomazout-${names[kind]}.csv`, 'csv');
    if (path) {
      this.toast.show(path === 'download' ? 'Fichier CSV téléchargé.' : `CSV enregistré : ${path}`);
    }
  }

  protected async importJson(): Promise<void> {
    const content = await this.storage.importFile();
    if (content === null) {
      return;
    }
    const ok = await this.confirm.ask({
      title: 'Remplacer les données ?',
      message: 'Les données actuelles (cuve, relevés, pleins, réglages) seront remplacées par le contenu du fichier importé.',
      confirmLabel: 'Importer',
      danger: true,
    });
    if (!ok) {
      return;
    }
    try {
      this.store.importJson(content);
      this.toast.show('Données importées.');
    } catch (error) {
      this.toast.show(`Import impossible : ${error instanceof Error ? error.message : error}`, 'error');
    }
  }

  protected async loadDemo(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Charger les données de démonstration ?',
      message: 'Vos données actuelles seront remplacées par une cuve et deux ans d’historique fictifs. Exportez-les d’abord si nécessaire.',
      confirmLabel: 'Charger la démo',
      danger: this.counts().readings + this.counts().refills > 0,
    });
    if (ok) {
      this.store.loadDemo();
      this.toast.show('Données de démonstration chargées.', 'info');
    }
  }

  protected async reset(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Tout effacer ?',
      message: 'La cuve, tous les relevés, tous les pleins et les réglages seront supprimés. Cette action est définitive (sauf sauvegarde exportée).',
      confirmLabel: 'Tout effacer',
      danger: true,
    });
    if (ok) {
      this.store.reset();
      this.toast.show('Toutes les données ont été effacées.', 'info');
    }
  }
}
