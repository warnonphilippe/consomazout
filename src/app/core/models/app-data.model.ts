import type { ThemeMode } from '../../../../electron/shared/ipc-contract';

export type { ThemeMode };

/**
 * `gauge` : cuve équipée d'une jauge affichant directement les litres, dont on ne connaît que la capacité.
 * Les relevés se font alors en litres uniquement.
 */
export type TankShape = 'rectangular' | 'verticalCylinder' | 'horizontalCylinder' | 'table' | 'gauge';

/** Point d'une table de jaugeage : hauteur mesurée → litres (fournie par le fabricant ou mesurée). */
export interface CalibrationPoint {
  heightCm: number;
  liters: number;
}

export interface Tank {
  name: string;
  shape: TankShape;
  /** Longueur (rectangulaire, cylindre horizontal). */
  lengthCm: number;
  /** Largeur (rectangulaire). */
  widthCm: number;
  /** Hauteur (rectangulaire, cylindre vertical). */
  heightCm: number;
  /** Diamètre (cylindres). */
  diameterCm: number;
  calibration: CalibrationPoint[];
  /** Capacité totale en litres (cuve à jauge). */
  capacityLiters: number;
  /** Nombre de cuves identiques reliées entre elles (batterie). */
  count: number;
  /** Remplissage maximal autorisé, en % de la capacité (95 % en général). */
  maxFillPct: number;
}

/**
 * Relevé : soit la hauteur de mazout mesurée (convertie en litres selon la cuve),
 * soit la quantité lue directement sur une jauge. Exactement un des deux est renseigné.
 */
export interface Reading {
  id: string;
  /** Date et heure locales, format `YYYY-MM-DDTHH:mm`. */
  date: string;
  heightCm: number | null;
  liters: number | null;
  note: string;
}

/** Mesure faite lors d'un relevé : hauteur en cm ou quantité en litres. */
export type Measure = { readonly kind: 'height'; readonly value: number } | { readonly kind: 'liters'; readonly value: number };

export function measureOf(reading: Reading): Measure | null {
  if (reading.liters !== null && Number.isFinite(reading.liters)) {
    return { kind: 'liters', value: reading.liters };
  }
  if (reading.heightCm !== null && Number.isFinite(reading.heightCm)) {
    return { kind: 'height', value: reading.heightCm };
  }
  return null;
}

export function measureFields(measure: Measure): Pick<Reading, 'heightCm' | 'liters'> {
  return measure.kind === 'height'
    ? { heightCm: measure.value, liters: null }
    : { heightCm: null, liters: measure.value };
}

export interface Refill {
  id: string;
  /** Date et heure locales, format `YYYY-MM-DDTHH:mm`. */
  date: string;
  liters: number;
  /** Prix au litre TVAC (€). */
  pricePerLiter: number;
  /** Montant total TVAC (€). */
  totalPrice: number;
  supplier: string;
  note: string;
}

export type ReferencePreset = 'renovated' | 'average' | 'poor' | 'custom';

export interface Settings {
  referencePreset: ReferencePreset;
  /** Consommation annuelle de référence (chauffage + eau chaude), en litres. */
  referenceAnnualLiters: number;
  /** Part de l'eau chaude sanitaire, en litres par an (consommée toute l'année). */
  hotWaterLitersPerYear: number;
  /** Seuil d'alerte, en % de la capacité. */
  alertThresholdPct: number;
  /** Délai entre la commande et la livraison, en jours. */
  orderLeadDays: number;
  theme: ThemeMode;
}

export interface AppData {
  schemaVersion: 1;
  tank: Tank | null;
  readings: Reading[];
  refills: Refill[];
  settings: Settings;
}

export const REFERENCE_PRESETS: Record<Exclude<ReferencePreset, 'custom'>, { label: string; liters: number }> = {
  renovated: { label: 'Maison rénovée / bien isolée', liters: 1500 },
  average: { label: 'Maison moyenne (référence belge)', liters: 2000 },
  poor: { label: 'Maison peu isolée', liters: 2500 },
};

export const DEFAULT_SETTINGS: Settings = {
  referencePreset: 'average',
  referenceAnnualLiters: 2000,
  hotWaterLitersPerYear: 300,
  alertThresholdPct: 20,
  orderLeadDays: 14,
  theme: 'system',
};

export const DEFAULT_TANK: Tank = {
  name: 'Cuve principale',
  shape: 'horizontalCylinder',
  lengthCm: 230,
  widthCm: 120,
  heightCm: 130,
  diameterCm: 130,
  calibration: [],
  capacityLiters: 3000,
  count: 1,
  maxFillPct: 95,
};

export function emptyData(): AppData {
  return { schemaVersion: 1, tank: null, readings: [], refills: [], settings: { ...DEFAULT_SETTINGS } };
}
