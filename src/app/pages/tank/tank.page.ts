import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { capacityLiters, tankHeightCm, usableCapacityLiters, validateTank, volumeAt } from '../../core/calc/tank-volume';
import { DEFAULT_TANK, measureOf, type CalibrationPoint, type Tank, type TankShape } from '../../core/models/app-data.model';
import { DataStore } from '../../core/services/data-store.service';
import { ToastService } from '../../core/services/toast.service';
import { FORMAT_PIPES } from '../../shared/format';
import { IconComponent } from '../../shared/icon.component';
import { TankDiagramComponent } from './tank-diagram.component';

interface ShapeOption {
  readonly shape: TankShape;
  readonly label: string;
  readonly hint: string;
}

@Component({
  selector: 'app-tank-page',
  imports: [ReactiveFormsModule, IconComponent, TankDiagramComponent, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tank.page.html',
  styleUrl: './tank.page.css',
})
export default class TankPage {
  private readonly store = inject(DataStore);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly shapes: ShapeOption[] = [
    { shape: 'horizontalCylinder', label: 'Cylindre couché', hint: 'Cuve acier en cave ou enterrée' },
    { shape: 'rectangular', label: 'Rectangulaire', hint: 'Cuve parallélépipédique (acier, plastique)' },
    { shape: 'verticalCylinder', label: 'Cylindre debout', hint: 'Cuve verticale' },
    { shape: 'table', label: 'Table de jaugeage', hint: 'Forme irrégulière, barème du fabricant' },
    { shape: 'gauge', label: 'Cuve à jauge', hint: 'Seule la capacité est connue ; relevés en litres' },
  ];

  private readonly initial = this.store.tank() ?? DEFAULT_TANK;
  protected readonly isNew = this.store.tank() === null;

  protected readonly form = this.fb.group({
    name: [this.initial.name, Validators.required],
    shape: [this.initial.shape],
    lengthCm: [this.initial.lengthCm],
    widthCm: [this.initial.widthCm],
    heightCm: [this.initial.heightCm],
    diameterCm: [this.initial.diameterCm],
    capacityLiters: [this.initial.capacityLiters],
    count: [this.initial.count, [Validators.required, Validators.min(1)]],
    maxFillPct: [this.initial.maxFillPct, [Validators.required, Validators.min(1), Validators.max(100)]],
    calibration: this.fb.array(this.initial.calibration.map((p) => this.pointGroup(p))),
  });

  protected readonly pasteText = signal('');
  protected readonly testHeight = signal<number | null>(null);

  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected readonly draft = computed<Tank>(() => {
    this.value();
    const raw = this.form.getRawValue();
    return {
      ...raw,
      name: raw.name.trim() || DEFAULT_TANK.name,
      calibration: raw.calibration.filter((p) => Number.isFinite(p.heightCm) && Number.isFinite(p.liters)),
    };
  });

  protected readonly errors = computed(() => validateTank(this.draft()));

  /** Relevés encodés en hauteur, inutilisables si la cuve devient une cuve à jauge. */
  protected readonly heightReadingsLost = computed(() =>
    this.draft().shape === 'gauge' ? this.store.data().readings.filter((r) => measureOf(r)?.kind === 'height').length : 0,
  );
  protected readonly shape = computed(() => this.draft().shape);
  protected readonly capacity = computed(() => (this.errors().length === 0 ? capacityLiters(this.draft()) : null));
  protected readonly usable = computed(() => (this.errors().length === 0 ? usableCapacityLiters(this.draft()) : null));
  protected readonly maxHeight = computed(() => tankHeightCm(this.draft()));
  protected readonly testResult = computed(() => {
    const h = this.testHeight();
    const capacity = this.capacity();
    if (h === null || capacity === null || !Number.isFinite(h)) {
      return null;
    }
    const liters = volumeAt(this.draft(), h);
    return { liters, pct: (liters / capacity) * 100, clipped: h > this.maxHeight() };
  });

  /** Graduations du barème calculé (tous les 10 cm), utiles pour vérifier ou imprimer. */
  protected readonly scale = computed(() => {
    if (this.errors().length > 0 || this.draft().shape === 'gauge') {
      return [];
    }
    const tank = this.draft();
    const max = this.maxHeight();
    const step = max > 150 ? 20 : 10;
    const rows: { h: number; liters: number }[] = [];
    for (let h = step; h < max; h += step) {
      rows.push({ h, liters: volumeAt(tank, h) });
    }
    rows.push({ h: max, liters: volumeAt(tank, max) });
    return rows;
  });

  protected get calibration(): FormArray {
    return this.form.controls.calibration;
  }

  protected selectShape(shape: TankShape): void {
    this.form.controls.shape.setValue(shape);
    if (shape === 'table' && this.calibration.length === 0) {
      this.addPoint();
      this.addPoint();
    }
  }

  protected addPoint(): void {
    const points = this.form.getRawValue().calibration;
    const last = points.at(-1);
    this.calibration.push(this.pointGroup({ heightCm: last ? last.heightCm + 10 : 0, liters: last ? last.liters : 0 }));
  }

  protected removePoint(index: number): void {
    this.calibration.removeAt(index);
  }

  /** Colle une table « hauteur ; litres » (une ligne par point, séparateurs ; tabulation espace). */
  protected applyPaste(): void {
    const points: CalibrationPoint[] = [];
    for (const line of this.pasteText().split(/\r?\n/)) {
      const parts = line
        .trim()
        .split(/[;\t ]+/)
        .map((p) => Number(p.replace(',', '.')));
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        points.push({ heightCm: parts[0]!, liters: parts[1]! });
      }
    }
    if (points.length === 0) {
      this.toast.show('Aucune ligne « hauteur ; litres » reconnue.', 'warning');
      return;
    }
    this.calibration.clear();
    points.sort((a, b) => a.heightCm - b.heightCm).forEach((p) => this.calibration.push(this.pointGroup(p)));
    this.pasteText.set('');
    this.toast.show(`${points.length} points importés dans la table.`);
  }

  protected save(): void {
    if (this.errors().length > 0 || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const tank = this.draft();
    this.store.setTank({
      ...tank,
      calibration: tank.calibration.slice().sort((a, b) => a.heightCm - b.heightCm),
    });
    this.toast.show('Cuve enregistrée.');
    this.form.markAsPristine();
    if (this.isNew) {
      void this.router.navigateByUrl('/releves');
    }
  }

  protected numberValue(event: Event): number | null {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    return Number.isFinite(value) ? value : null;
  }

  private pointGroup(point: CalibrationPoint) {
    return this.fb.group({
      heightCm: [point.heightCm, Validators.required],
      liters: [point.liters, Validators.required],
    });
  }
}
