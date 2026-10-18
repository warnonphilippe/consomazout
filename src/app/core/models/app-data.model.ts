import type { ThemeMode } from '../../../../electron/shared/ipc-contract';

export type { ThemeMode };

export type TankShape = 'rectangular' | 'verticalCylinder' | 'horizontalCylinder' | 'table';

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
  /** Nombre de cuves identiques reliées entre elles (batterie). */
  count: number;
  /** Remplissage maximal autorisé, en % de la capacité (95 % en général). */
  maxFillPct: number;
}

export interface Reading {
  id: string;
  /** Date et heure locales, format `YYYY-MM-DDTHH:mm`. */
  date: string;
  heightCm: number;
  note: string;
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
  count: 1,
  maxFillPct: 95,
};

export function emptyData(): AppData {
  return { schemaVersion: 1, tank: null, readings: [], refills: [], settings: { ...DEFAULT_SETTINGS } };
}
