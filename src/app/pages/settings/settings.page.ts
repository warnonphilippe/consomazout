import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { monthlyCsv, readingsCsv, refillsCsv } from '../../core/calc/csv';
import { UCCLE_DEGREE_DAYS } from '../../core/calc/degree-days';
import { MONTH_SHORT } from '../../core/calc/time';
import { AiService } from '../../core/ai/ai.service';
import {
  AI_MODELS,
  LOCAL_MODELS,
  OPENAI_MODELS,
  REFERENCE_PRESETS,
  type AiProvider,
  type AppData,
  type ReferencePreset,
  type ThemeMode,
} from '../../core/models/app-data.model';
import type { LocalDownloadProgress } from '../../../../electron/shared/ipc-contract';
import type { MergeReport } from '../../core/models/merge';
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

  protected readonly ai = inject(AiService);
  protected readonly models = AI_MODELS;
  protected readonly keyDraft = signal('');
  protected readonly keyBusy = signal(false);
  protected readonly testResult = signal<{ ok: boolean; message: string } | null>(null);
  protected readonly openaiModels = OPENAI_MODELS;
  protected readonly openaiKeyDraft = signal('');
  protected readonly localModels = LOCAL_MODELS;
  protected readonly localBusy = signal(false);

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
  protected readonly pendingImport = signal<{ incoming: AppData; report: MergeReport } | null>(null);
  private readonly importDialog = viewChild<ElementRef<HTMLDialogElement>>('importDialog');

  protected readonly counts = computed(() => ({
    readings: this.store.data().readings.length,
    refills: this.store.data().refills.length,
  }));

  constructor() {
    effect(() => {
      const dialog = this.importDialog()?.nativeElement;
      if (!dialog) {
        return;
      }
      if (this.pendingImport() && !dialog.open) {
        dialog.showModal();
      } else if (!this.pendingImport() && dialog.open) {
        dialog.close();
      }
    });
  }

  protected async saveKey(): Promise<void> {
    const key = this.keyDraft().trim();
    if (key === '' || this.keyBusy()) {
      return;
    }
    this.keyBusy.set(true);
    try {
      await this.ai.setKey(key);
      this.keyDraft.set('');
      this.testResult.set(null);
      this.toast.show('Clé API enregistrée, chiffrée par le système.');
    } catch (error) {
      this.toast.show(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      this.keyBusy.set(false);
    }
  }

  protected async removeKey(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Supprimer la clé API ?',
      message: 'L’assistant IA sera désactivé jusqu’à ce que vous enregistriez une nouvelle clé.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) {
      await this.ai.clearKey();
      this.testResult.set(null);
      this.toast.show('Clé API supprimée.');
    }
  }

  protected async testKey(): Promise<void> {
    this.keyBusy.set(true);
    this.testResult.set(null);
    try {
      this.testResult.set(await this.ai.test());
    } catch (error) {
      this.testResult.set({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.keyBusy.set(false);
    }
  }

  protected setModel(event: Event): void {
    this.store.updateSettings({ aiModel: (event.target as HTMLSelectElement).value });
    this.testResult.set(null);
  }

  protected setProvider(provider: AiProvider): void {
    if (provider !== this.ai.provider()) {
      this.store.updateSettings({ aiProvider: provider });
      this.testResult.set(null);
      if (provider === 'local') {
        void this.ai.refreshLocalStatus();
      } else if (provider === 'openai') {
        void this.ai.refreshOpenAiStatus();
      }
    }
  }

  protected async saveOpenAiKey(): Promise<void> {
    const key = this.openaiKeyDraft().trim();
    if (key === '' || this.keyBusy()) {
      return;
    }
    this.keyBusy.set(true);
    try {
      await this.ai.setOpenAiKey(key);
      this.openaiKeyDraft.set('');
      this.testResult.set(null);
      this.toast.show('Clé API OpenAI enregistrée, chiffrée par le système.');
    } catch (error) {
      this.toast.show(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      this.keyBusy.set(false);
    }
  }

  protected async removeOpenAiKey(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Supprimer la clé API OpenAI ?',
      message: 'L’assistant ne pourra plus utiliser OpenAI jusqu’à ce que vous enregistriez une nouvelle clé.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) {
      await this.ai.clearOpenAiKey();
      this.testResult.set(null);
      this.toast.show('Clé API OpenAI supprimée.');
    }
  }

  protected async testOpenAiKey(): Promise<void> {
    this.keyBusy.set(true);
    this.testResult.set(null);
    try {
      this.testResult.set(await this.ai.testOpenAi());
    } catch (error) {
      this.testResult.set({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.keyBusy.set(false);
    }
  }

  protected setOpenAiModel(event: Event): void {
    this.store.updateSettings({ openaiModel: (event.target as HTMLSelectElement).value });
    this.testResult.set(null);
  }

  protected setLocalModel(id: string): void {
    this.store.updateSettings({ localModel: id });
    this.testResult.set(null);
  }

  protected isDownloaded(id: string): boolean {
    return this.ai.localStatus().models.some((m) => m.id === id && m.downloaded);
  }

  protected labelOf(id: string): string {
    return LOCAL_MODELS.find((m) => m.id === id)?.label ?? id;
  }

  protected gigabytes(bytes: number): string {
    return `${(bytes / 1e9).toLocaleString('fr-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Go`;
  }

  protected percent(p: LocalDownloadProgress): number {
    return p.totalBytes > 0 ? Math.floor((p.receivedBytes / p.totalBytes) * 100) : 0;
  }

  protected async downloadModel(): Promise<void> {
    this.testResult.set(null);
    await this.runLocal(() => this.ai.downloadModel(this.ai.localModel().id));
  }

  protected async cancelDownload(): Promise<void> {
    await this.runLocal(() => this.ai.cancelDownload());
  }

  protected async testLocal(): Promise<void> {
    this.testResult.set(null);
    await this.runLocal(async () => this.testResult.set(await this.ai.testLocal()));
  }

  protected async removeModel(): Promise<void> {
    const model = this.ai.localModel();
    const ok = await this.confirm.ask({
      title: `Supprimer ${model.label} ?`,
      message: `Le fichier du modèle (${this.gigabytes(model.sizeBytes)}) sera effacé de cet ordinateur. Il pourra être téléchargé à nouveau.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) {
      this.testResult.set(null);
      await this.runLocal(async () => {
        await this.ai.removeModel(model.id);
        this.toast.show('Modèle supprimé.');
      });
    }
  }

  private async runLocal(task: () => Promise<void>): Promise<void> {
    this.localBusy.set(true);
    try {
      await task();
    } catch (error) {
      this.toast.show(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      this.localBusy.set(false);
    }
  }

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

  /** Choix d'un fichier exporté, puis aperçu de ce qu'il apporte avant de l'appliquer. */
  protected async importJson(): Promise<void> {
    const content = await this.storage.importFile();
    if (content === null) {
      return;
    }
    try {
      const incoming = this.store.parseImport(content);
      this.pendingImport.set({ incoming, report: this.store.previewMerge(incoming).report });
    } catch (error) {
      this.toast.show(`Import impossible : ${error instanceof Error ? error.message : error}`, 'error');
    }
  }

  protected cancelImport(): void {
    this.pendingImport.set(null);
  }

  protected applyMerge(): void {
    const pending = this.pendingImport();
    if (!pending) {
      return;
    }
    const report = this.store.mergeImport(pending.incoming);
    this.pendingImport.set(null);
    const added = report.addedReadings + report.addedRefills;
    this.toast.show(
      added > 0
        ? `${report.addedReadings} relevé(s) et ${report.addedRefills} plein(s) ajoutés ; vos données existantes sont inchangées.`
        : 'Rien de nouveau dans ce fichier : vos données sont déjà à jour.',
      added > 0 ? 'success' : 'info',
    );
  }

  protected async applyReplace(): Promise<void> {
    const pending = this.pendingImport();
    if (!pending) {
      return;
    }
    this.pendingImport.set(null);
    const ok = await this.confirm.ask({
      title: 'Remplacer toutes les données ?',
      message:
        'La cuve, les relevés, les pleins et les réglages de cet ordinateur seront remplacés par le contenu du fichier. ' +
        'Les relevés absents du fichier seront perdus.',
      confirmLabel: 'Tout remplacer',
      danger: true,
    });
    if (ok) {
      this.store.replaceWithImport(pending.incoming);
      this.toast.show('Données remplacées par le contenu du fichier.');
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
