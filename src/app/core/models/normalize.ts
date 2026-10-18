import {
  DEFAULT_SETTINGS,
  DEFAULT_TANK,
  emptyData,
  type AppData,
  type CalibrationPoint,
  type Reading,
  type Refill,
  type Settings,
  type Tank,
  type TankShape,
} from './app-data.model';

type Raw = Record<string, unknown>;

const SHAPES: readonly TankShape[] = ['rectangular', 'verticalCylinder', 'horizontalCylinder', 'table', 'gauge'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/;

/**
 * Valide et complète des données lues sur disque ou importées : champs manquants remplacés
 * par leurs valeurs par défaut, entrées invalides écartées.
 * Lève une erreur si le contenu n'a manifestement rien à voir avec ConsoMazout.
 */
export function normalizeData(input: unknown): AppData {
  if (!isObject(input) || !('settings' in input || 'readings' in input || 'tank' in input)) {
    throw new Error('Ce fichier ne contient pas de données ConsoMazout.');
  }
  const base = emptyData();
  return {
    schemaVersion: 1,
    tank: isObject(input['tank']) ? normalizeTank(input['tank']) : null,
    readings: asArray(input['readings']).map(normalizeReading).filter((r): r is Reading => r !== null),
    refills: asArray(input['refills']).map(normalizeRefill).filter((r): r is Refill => r !== null),
    settings: isObject(input['settings']) ? normalizeSettings(input['settings']) : base.settings,
  };
}

function normalizeTank(raw: Raw): Tank {
  const shape = SHAPES.includes(raw['shape'] as TankShape) ? (raw['shape'] as TankShape) : DEFAULT_TANK.shape;
  return {
    name: str(raw['name'], DEFAULT_TANK.name),
    shape,
    lengthCm: num(raw['lengthCm'], DEFAULT_TANK.lengthCm),
    widthCm: num(raw['widthCm'], DEFAULT_TANK.widthCm),
    heightCm: num(raw['heightCm'], DEFAULT_TANK.heightCm),
    diameterCm: num(raw['diameterCm'], DEFAULT_TANK.diameterCm),
    calibration: asArray(raw['calibration'])
      .filter(isObject)
      .map((p): CalibrationPoint => ({ heightCm: num(p['heightCm'], Number.NaN), liters: num(p['liters'], Number.NaN) }))
      .filter((p) => Number.isFinite(p.heightCm) && Number.isFinite(p.liters)),
    capacityLiters: num(raw['capacityLiters'], DEFAULT_TANK.capacityLiters),
    count: Math.max(1, Math.round(num(raw['count'], 1))),
    maxFillPct: num(raw['maxFillPct'], DEFAULT_TANK.maxFillPct),
  };
}

function normalizeReading(raw: unknown): Reading | null {
  if (!isObject(raw) || !DATE_RE.test(str(raw['date'], ''))) {
    return null;
  }
  // Les anciens fichiers ne contiennent que la hauteur ; une quantité en litres prime si elle est présente.
  const liters = num(raw['liters'], Number.NaN);
  const heightCm = num(raw['heightCm'], Number.NaN);
  if (!Number.isFinite(liters) && !Number.isFinite(heightCm)) {
    return null;
  }
  return {
    id: str(raw['id'], newId()),
    date: normalizeDate(str(raw['date'], '')),
    heightCm: Number.isFinite(liters) ? null : heightCm,
    liters: Number.isFinite(liters) ? liters : null,
    note: str(raw['note'], ''),
  };
}

function normalizeRefill(raw: unknown): Refill | null {
  if (!isObject(raw) || !DATE_RE.test(str(raw['date'], ''))) {
    return null;
  }
  const liters = num(raw['liters'], Number.NaN);
  if (!(liters > 0)) {
    return null;
  }
  const pricePerLiter = num(raw['pricePerLiter'], 0);
  return {
    id: str(raw['id'], newId()),
    date: normalizeDate(str(raw['date'], '')),
    liters,
    pricePerLiter,
    totalPrice: num(raw['totalPrice'], Math.round(liters * pricePerLiter * 100) / 100),
    supplier: str(raw['supplier'], ''),
    note: str(raw['note'], ''),
  };
}

function normalizeSettings(raw: Raw): Settings {
  const preset = raw['referencePreset'];
  const theme = raw['theme'];
  return {
    referencePreset:
      preset === 'renovated' || preset === 'average' || preset === 'poor' || preset === 'custom'
        ? preset
        : DEFAULT_SETTINGS.referencePreset,
    referenceAnnualLiters: num(raw['referenceAnnualLiters'], DEFAULT_SETTINGS.referenceAnnualLiters),
    hotWaterLitersPerYear: num(raw['hotWaterLitersPerYear'], DEFAULT_SETTINGS.hotWaterLitersPerYear),
    alertThresholdPct: num(raw['alertThresholdPct'], DEFAULT_SETTINGS.alertThresholdPct),
    orderLeadDays: num(raw['orderLeadDays'], DEFAULT_SETTINGS.orderLeadDays),
    theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : DEFAULT_SETTINGS.theme,
  };
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** `YYYY-MM-DD` → `YYYY-MM-DDT12:00` ; sinon tronqué à la minute. */
function normalizeDate(value: string): string {
  return value.length === 10 ? `${value}T12:00` : value.slice(0, 16);
}

function isObject(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}
