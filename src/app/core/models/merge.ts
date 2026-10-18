import type { AppData, Reading, Refill, Tank } from './app-data.model';

export interface MergeReport {
  /** Relevés du fichier ajoutés aux données locales. */
  readonly addedReadings: number;
  readonly addedRefills: number;
  /** Entrées du fichier déjà présentes localement (identiques) : ignorées. */
  readonly duplicateReadings: number;
  readonly duplicateRefills: number;
  /** Entrées présentes des deux côtés mais modifiées différemment : la version locale est conservée. */
  readonly conflicts: number;
  /** La cuve du fichier a été reprise car aucune cuve n'était configurée localement. */
  readonly tankAdopted: boolean;
  /** La cuve du fichier diffère de la cuve locale (la cuve locale est conservée). */
  readonly tankDiffers: boolean;
}

export interface MergeResult {
  readonly data: AppData;
  readonly report: MergeReport;
}

/**
 * Fusionne des données importées (export JSON d'un autre ordinateur) dans les données locales.
 * Rien de local n'est modifié ni supprimé : seuls les relevés et pleins absents sont ajoutés.
 * Une entrée est « déjà présente » si elle a le même identifiant, ou la même date et la même
 * valeur (même relevé encodé séparément sur les deux ordinateurs).
 */
export function mergeData(local: AppData, incoming: AppData): MergeResult {
  const readings = mergeList(local.readings, incoming.readings, sameReading, readingKey);
  const refills = mergeList(local.refills, incoming.refills, sameRefill, refillKey);
  const tankAdopted = local.tank === null && incoming.tank !== null;
  const tankDiffers = local.tank !== null && incoming.tank !== null && !sameTank(local.tank, incoming.tank);

  return {
    data: {
      ...local,
      tank: tankAdopted ? incoming.tank : local.tank,
      readings: readings.list,
      refills: refills.list,
    },
    report: {
      addedReadings: readings.added,
      addedRefills: refills.added,
      duplicateReadings: readings.duplicates,
      duplicateRefills: refills.duplicates,
      conflicts: readings.conflicts + refills.conflicts,
      tankAdopted,
      tankDiffers,
    },
  };
}

function mergeList<T extends { id: string }>(
  local: T[],
  incoming: T[],
  same: (a: T, b: T) => boolean,
  key: (item: T) => string,
): { list: T[]; added: number; duplicates: number; conflicts: number } {
  const byId = new Map(local.map((item) => [item.id, item]));
  const keys = new Set(local.map(key));
  const list = [...local];
  let added = 0;
  let duplicates = 0;
  let conflicts = 0;
  for (const item of incoming) {
    const existing = byId.get(item.id);
    if (existing) {
      if (same(existing, item)) {
        duplicates++;
      } else {
        conflicts++;
      }
      continue;
    }
    if (keys.has(key(item))) {
      duplicates++;
      continue;
    }
    list.push(item);
    byId.set(item.id, item);
    keys.add(key(item));
    added++;
  }
  return { list, added, duplicates, conflicts };
}

const readingKey = (r: Reading): string => `${r.date}|${r.heightCm}`;
const refillKey = (r: Refill): string => `${r.date}|${r.liters}`;

const sameReading = (a: Reading, b: Reading): boolean =>
  a.date === b.date && a.heightCm === b.heightCm && a.note === b.note;

const sameRefill = (a: Refill, b: Refill): boolean =>
  a.date === b.date &&
  a.liters === b.liters &&
  a.pricePerLiter === b.pricePerLiter &&
  a.totalPrice === b.totalPrice &&
  a.supplier === b.supplier &&
  a.note === b.note;

function sameTank(a: Tank, b: Tank): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
