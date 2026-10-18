import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { tankHeightCm, volumeAt } from '../../core/calc/tank-volume';
import { toLocalIso } from '../../core/calc/time';
import type { Refill } from '../../core/models/app-data.model';
import { ConfirmService } from '../../core/services/confirm.service';
import { DataStore } from '../../core/services/data-store.service';
import { ToastService } from '../../core/services/toast.service';
import { FORMAT_PIPES, fmt } from '../../shared/format';
import { IconComponent } from '../../shared/icon.component';

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

@Component({
  selector: 'app-refills-page',
  imports: [ReactiveFormsModule, IconComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './refills.page.html',
  styleUrl: './refills.page.css',
})
export default class RefillsPage {
  protected readonly store = inject(DataStore);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly editingId = signal<string | null>(null);

  protected readonly form = this.fb.group({
    date: [toLocalIso(new Date()), Validators.required],
    liters: [null as number | null, [Validators.required, Validators.min(1)]],
    pricePerLiter: [this.store.analysis().refills.lastPrice as number | null, [Validators.min(0)]],
    totalPrice: [null as number | null, [Validators.min(0)]],
    supplier: [''],
    heightAfterCm: [null as number | null, [Validators.min(0)]],
    note: [''],
  });

  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected readonly suppliers = computed(() =>
    [...new Set(this.store.data().refills.map((r) => r.supplier.trim()).filter((s) => s !== ''))].sort(),
  );

  protected readonly totals = computed(() => this.store.analysis().refills);
  protected readonly maxHeight = computed(() => {
    const tank = this.store.tank();
    return tank ? tankHeightCm(tank) : null;
  });

  /** Litres après le plein, d'après la hauteur saisie (si fournie). */
  protected readonly afterPreview = computed(() => {
    const h = this.value().heightAfterCm;
    const tank = this.store.tank();
    if (!tank || h === null || h === undefined || !Number.isFinite(h)) {
      return null;
    }
    return volumeAt(tank, h);
  });

  /** Place libre estimée aujourd'hui : utile pour savoir combien commander. */
  protected readonly freeSpace = computed(() => {
    const analysis = this.store.analysis();
    return analysis.best ? Math.max(0, analysis.usableCapacity - analysis.best.currentLiters) : null;
  });

  protected onLitersOrPrice(): void {
    const { liters, pricePerLiter } = this.form.getRawValue();
    if (liters && pricePerLiter !== null && pricePerLiter !== undefined) {
      this.form.controls.totalPrice.setValue(round2(liters * pricePerLiter), { emitEvent: true });
    }
  }

  protected onTotal(): void {
    const { liters, totalPrice } = this.form.getRawValue();
    if (liters && totalPrice !== null && totalPrice !== undefined) {
      this.form.controls.pricePerLiter.setValue(round3(totalPrice / liters));
    }
  }

  protected useFreeSpace(): void {
    const free = this.freeSpace();
    if (free !== null) {
      this.form.controls.liters.setValue(Math.floor(free / 50) * 50);
      this.onLitersOrPrice();
    }
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const liters = raw.liters!;
    const price = raw.pricePerLiter ?? (raw.totalPrice ? round3(raw.totalPrice / liters) : 0);
    const total = raw.totalPrice ?? round2(liters * price);
    const id = this.editingId();
    this.store.saveRefill(
      {
        ...(id ? { id } : {}),
        date: raw.date,
        liters,
        pricePerLiter: price,
        totalPrice: total,
        supplier: raw.supplier.trim(),
        note: raw.note.trim(),
      },
      id === null ? raw.heightAfterCm : null,
    );
    this.toast.show(id ? 'Plein modifié.' : `Plein de ${fmt.liters(liters)} enregistré.`);
    this.resetForm();
  }

  protected edit(refill: Refill): void {
    this.editingId.set(refill.id);
    this.form.setValue({
      date: refill.date,
      liters: refill.liters,
      pricePerLiter: refill.pricePerLiter,
      totalPrice: refill.totalPrice,
      supplier: refill.supplier,
      heightAfterCm: null,
      note: refill.note,
    });
    document.querySelector('.page')?.scrollIntoView({ behavior: 'smooth' });
  }

  protected async remove(refill: Refill): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Supprimer ce plein ?',
      message: `Le plein du ${fmt.date(refill.date)} (${fmt.liters(refill.liters)}) sera supprimé. Les relevés ne sont pas modifiés.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) {
      this.store.deleteRefill(refill.id);
      if (this.editingId() === refill.id) {
        this.resetForm();
      }
      this.toast.show('Plein supprimé.');
    }
  }

  protected resetForm(): void {
    this.editingId.set(null);
    this.form.reset({
      date: toLocalIso(new Date()),
      liters: null,
      pricePerLiter: this.store.analysis().refills.lastPrice,
      totalPrice: null,
      supplier: '',
      heightAfterCm: null,
      note: '',
    });
  }
}
