import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { ConsumptionInterval } from '../../core/calc/consumption';
import { tankHeightCm, volumeAt } from '../../core/calc/tank-volume';
import { toDayNumber, toLocalIso } from '../../core/calc/time';
import type { Reading } from '../../core/models/app-data.model';
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

  protected readonly form = this.fb.group({
    date: [toLocalIso(new Date()), Validators.required],
    heightCm: [null as number | null, [Validators.required, Validators.min(0)]],
    note: [''],
  });

  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected readonly tank = this.store.tank;
  protected readonly maxHeight = computed(() => {
    const tank = this.tank();
    return tank ? tankHeightCm(tank) : 0;
  });

  /** Aperçu en direct du contenu correspondant à la hauteur saisie. */
  protected readonly preview = computed(() => {
    const { heightCm, date } = this.value();
    const tank = this.tank();
    const analysis = this.store.analysis();
    if (!tank || heightCm === null || heightCm === undefined || !Number.isFinite(heightCm)) {
      return null;
    }
    const liters = volumeAt(tank, heightCm);
    const day = toDayNumber(date ?? '');
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
      tooHigh: heightCm > this.maxHeight(),
      since,
    };
  });

  protected readonly estimatedHeight = computed(() => {
    this.store.analysis();
    return this.store.estimatedHeightNow();
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

  protected readonly anomalies = computed(() => this.rows().filter((r) => r.interval?.anomaly).length);

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { date, heightCm, note } = this.form.getRawValue();
    const id = this.editingId();
    this.store.saveReading({ ...(id ? { id } : {}), date, heightCm: heightCm!, note: note.trim() });
    this.toast.show(id ? 'Relevé modifié.' : `Relevé du ${fmt.dateTime(date)} enregistré.`);
    this.resetForm();
  }

  protected edit(reading: Reading): void {
    this.editingId.set(reading.id);
    this.form.setValue({ date: reading.date, heightCm: reading.heightCm, note: reading.note });
    document.querySelector('.page')?.scrollIntoView({ behavior: 'smooth' });
  }

  protected async remove(reading: Reading): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Supprimer ce relevé ?',
      message: `Le relevé du ${fmt.dateTime(reading.date)} (${reading.heightCm} cm) sera supprimé. Les statistiques seront recalculées.`,
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
    const h = this.estimatedHeight();
    if (h !== null) {
      this.form.controls.heightCm.setValue(Math.round(h * 2) / 2);
    }
  }

  protected resetForm(): void {
    this.editingId.set(null);
    this.form.reset({ date: toLocalIso(new Date()), heightCm: null, note: '' });
  }
}
