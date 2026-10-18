import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { ConsumptionInterval } from '../../core/calc/consumption';
import { capacityLiters, measureToLiters, supportsHeight, tankHeightCm } from '../../core/calc/tank-volume';
import { toDayNumber, toLocalIso } from '../../core/calc/time';
import { measureFields, measureOf, type Measure, type Reading } from '../../core/models/app-data.model';
import { ConfirmService } from '../../core/services/confirm.service';
import { DataStore } from '../../core/services/data-store.service';
import { ToastService } from '../../core/services/toast.service';
import { FORMAT_PIPES, fmt } from '../../shared/format';
import { IconComponent } from '../../shared/icon.component';

interface ReadingRow {
  readonly reading: Reading;
  readonly liters: number;
  readonly pct: number;
  readonly interval: ConsumptionInterval | null;
}

type MeasureKind = Measure['kind'];

@Component({
  selector: 'app-readings-page',
  imports: [ReactiveFormsModule, RouterLink, IconComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './readings.page.html',
  styleUrl: './readings.page.css',
})
export default class ReadingsPage {
  protected readonly store = inject(DataStore);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly editingId = signal<string | null>(null);

  protected readonly tank = this.store.tank;
  /** Une cuve à jauge n'a pas de dimensions : on ne peut y encoder que des litres. */
  protected readonly heightAllowed = computed(() => {
    const tank = this.tank();
    return tank !== null && supportsHeight(tank);
  });

  /** Mode de saisie : par défaut celui du dernier relevé encodé. */
  protected readonly mode = linkedSignal<MeasureKind>(() => {
    if (!this.heightAllowed()) {
      return 'liters';
    }
    const last = this.store.readings()[0];
    return last && measureOf(last)?.kind === 'liters' ? 'liters' : 'height';
  });

  protected readonly form = this.fb.group({
    date: [toLocalIso(new Date()), Validators.required],
    heightCm: [null as number | null, Validators.min(0)],
    liters: [null as number | null, Validators.min(0)],
    note: [''],
  });

  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected readonly maxHeight = computed(() => {
    const tank = this.tank();
    return tank ? tankHeightCm(tank) : 0;
  });
  protected readonly capacity = computed(() => {
    const tank = this.tank();
    return tank ? capacityLiters(tank) : 0;
  });

  /** Mesure saisie dans le mode courant, ou `null` si le champ est vide ou invalide. */
  protected readonly measure = computed<Measure | null>(() => {
    const value = this.value();
    const raw = this.mode() === 'height' ? value.heightCm : value.liters;
    return raw === null || raw === undefined || !Number.isFinite(raw) || raw < 0 ? null : { kind: this.mode(), value: raw };
  });

  protected readonly canSave = computed(() => {
    this.value();
    return this.measure() !== null && this.form.controls.date.valid;
  });

  /** Aperçu en direct du contenu correspondant à la mesure saisie. */
  protected readonly preview = computed(() => {
    const measure = this.measure();
    const tank = this.tank();
    const analysis = this.store.analysis();
    if (!tank || measure === null) {
      return null;
    }
    const liters = measureToLiters(tank, measure);
    const day = toDayNumber(this.value().date ?? '');
    // Relevé précédent (hors relevé en cours d'édition), pour estimer la consommation.
    const previous = analysis.consumption?.levels
      .filter((l) => l.day < day && l.reading.id !== this.editingId())
      .at(-1);
    let since: { liters: number; days: number } | null = null;
    if (previous) {
      const refilled = this.store
        .data()
        .refills.filter((r) => toDayNumber(r.date) > previous.day && toDayNumber(r.date) <= day)
        .reduce((sum, r) => sum + r.liters, 0);
      since = { liters: previous.liters + refilled - liters, days: day - previous.day };
    }
    return {
      liters,
      pct: analysis.capacity > 0 ? (liters / analysis.capacity) * 100 : 0,
      tooHigh: measure.kind === 'height' ? measure.value > this.maxHeight() : measure.value > this.capacity(),
      since,
    };
  });

  /** Valeur estimée pour aujourd'hui dans le mode courant (aide à repérer une erreur de mesure). */
  protected readonly estimate = computed(() => {
    this.store.analysis();
    return this.mode() === 'height' ? this.store.estimatedHeightNow() : this.store.estimatedLitersNow();
  });

  protected readonly rows = computed<ReadingRow[]>(() => {
    const analysis = this.store.analysis();
    const consumption = analysis.consumption;
    if (!consumption) {
      return [];
    }
    const byTo = new Map(consumption.intervals.map((i) => [i.to.reading.id, i]));
    return consumption.levels
      .map((level) => ({
        reading: level.reading,
        liters: level.liters,
        pct: analysis.capacity > 0 ? (level.liters / analysis.capacity) * 100 : 0,
        interval: byTo.get(level.reading.id) ?? null,
      }))
      .reverse();
  });

  /** Relevés en hauteur inutilisables parce que la cuve est décrite comme une cuve à jauge. */
  protected readonly ignoredHeights = computed(() =>
    this.heightAllowed() ? 0 : this.store.data().readings.filter((r) => measureOf(r)?.kind === 'height').length,
  );

  protected readonly anomalies = computed(() => this.rows().filter((r) => r.interval?.anomaly).length);

  protected setMode(mode: MeasureKind): void {
    this.mode.set(mode);
  }

  protected save(): void {
    const measure = this.measure();
    if (measure === null || this.form.controls.date.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { date, note } = this.form.getRawValue();
    const id = this.editingId();
    this.store.saveReading({ ...(id ? { id } : {}), date, ...measureFields(measure), note: note.trim() });
    this.toast.show(id ? 'Relevé modifié.' : `Relevé du ${fmt.dateTime(date)} enregistré.`);
    this.resetForm();
  }

  protected edit(reading: Reading): void {
    const measure = measureOf(reading);
    this.editingId.set(reading.id);
    if (measure) {
      this.mode.set(measure.kind);
    }
    this.form.setValue({ date: reading.date, heightCm: reading.heightCm, liters: reading.liters, note: reading.note });
    document.querySelector('.page')?.scrollIntoView({ behavior: 'smooth' });
  }

  protected async remove(reading: Reading): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Supprimer ce relevé ?',
      message: `Le relevé du ${fmt.dateTime(reading.date)} (${describe(reading)}) sera supprimé. Les statistiques seront recalculées.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) {
      this.store.deleteReading(reading.id);
      if (this.editingId() === reading.id) {
        this.resetForm();
      }
      this.toast.show('Relevé supprimé.');
    }
  }

  protected useEstimate(): void {
    const value = this.estimate();
    if (value === null) {
      return;
    }
    if (this.mode() === 'height') {
      this.form.controls.heightCm.setValue(Math.round(value * 2) / 2);
    } else {
      this.form.controls.liters.setValue(Math.round(value / 10) * 10);
    }
  }

  protected resetForm(): void {
    this.editingId.set(null);
    this.form.reset({ date: toLocalIso(new Date()), heightCm: null, liters: null, note: '' });
  }
}

function describe(reading: Reading): string {
  const measure = measureOf(reading);
  return measure?.kind === 'liters' ? fmt.liters(measure.value) : `${reading.heightCm} cm`;
}
