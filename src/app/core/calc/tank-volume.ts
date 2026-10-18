import type { CalibrationPoint, Measure, Tank } from '../models/app-data.model';

/** Hauteur intérieure maximale mesurable de la cuve, en cm. */
export function tankHeightCm(tank: Tank): number {
  switch (tank.shape) {
    case 'rectangular':
    case 'verticalCylinder':
      return tank.heightCm;
    case 'horizontalCylinder':
      return tank.diameterCm;
    case 'table':
      return sortedCalibration(tank.calibration).at(-1)?.heightCm ?? 0;
    case 'gauge':
      return 0;
  }
}

/** La cuve permet-elle de convertir une hauteur en litres ? (Non pour une cuve à jauge.) */
export function supportsHeight(tank: Tank): boolean {
  return tank.shape !== 'gauge';
}

/** Contenu (litres) d'une mesure : hauteur convertie selon la cuve, ou litres lus sur la jauge. */
export function measureToLiters(tank: Tank, measure: Measure): number {
  return measure.kind === 'height'
    ? volumeAt(tank, measure.value)
    : Math.min(Math.max(measure.value, 0), capacityLiters(tank));
}

/** Volume (litres) contenu pour une hauteur de mazout donnée, toutes cuves de la batterie comprises. */
export function volumeAt(tank: Tank, heightCm: number): number {
  const height = Math.min(Math.max(heightCm, 0), tankHeightCm(tank));
  return singleTankVolume(tank, height) * Math.max(1, tank.count);
}

export function capacityLiters(tank: Tank): number {
  return tank.shape === 'gauge' ? tank.capacityLiters : volumeAt(tank, tankHeightCm(tank));
}

/** Volume maximal qu'on peut remplir (capacité × remplissage maximal autorisé). */
export function usableCapacityLiters(tank: Tank): number {
  return (capacityLiters(tank) * tank.maxFillPct) / 100;
}

/** Hauteur correspondant à un volume donné (inverse de `volumeAt`, par dichotomie). */
export function heightForVolume(tank: Tank, liters: number): number {
  const max = tankHeightCm(tank);
  if (liters <= 0) {
    return 0;
  }
  if (liters >= capacityLiters(tank)) {
    return max;
  }
  let low = 0;
  let high = max;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (volumeAt(tank, mid) < liters) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

/** Liste des problèmes empêchant de calculer les volumes (vide si la cuve est valide). */
export function validateTank(tank: Tank): string[] {
  const errors: string[] = [];
  const positive = (value: number, label: string): void => {
    if (!(value > 0)) {
      errors.push(`${label} doit être strictement positif.`);
    }
  };
  switch (tank.shape) {
    case 'rectangular':
      positive(tank.lengthCm, 'La longueur');
      positive(tank.widthCm, 'La largeur');
      positive(tank.heightCm, 'La hauteur');
      break;
    case 'verticalCylinder':
      positive(tank.diameterCm, 'Le diamètre');
      positive(tank.heightCm, 'La hauteur');
      break;
    case 'horizontalCylinder':
      positive(tank.diameterCm, 'Le diamètre');
      positive(tank.lengthCm, 'La longueur');
      break;
    case 'gauge':
      positive(tank.capacityLiters, 'La capacité');
      break;
    case 'table': {
      const points = sortedCalibration(tank.calibration);
      if (points.length < 2) {
        errors.push('La table de jaugeage doit contenir au moins deux points.');
      }
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1]!;
        const point = points[i]!;
        if (point.heightCm === prev.heightCm) {
          errors.push(`La hauteur ${point.heightCm} cm apparaît deux fois dans la table.`);
        } else if (point.liters < prev.liters) {
          errors.push(`Les litres doivent augmenter avec la hauteur (à ${point.heightCm} cm).`);
        }
      }
      break;
    }
  }
  if (!(tank.count >= 1)) {
    errors.push('Le nombre de cuves doit être au moins 1.');
  }
  if (!(tank.maxFillPct > 0 && tank.maxFillPct <= 100)) {
    errors.push('Le remplissage maximal doit être compris entre 1 et 100 %.');
  }
  return errors;
}

function singleTankVolume(tank: Tank, h: number): number {
  switch (tank.shape) {
    case 'rectangular':
      return (tank.lengthCm * tank.widthCm * h) / 1000;
    case 'verticalCylinder': {
      const r = tank.diameterCm / 2;
      return (Math.PI * r * r * h) / 1000;
    }
    case 'horizontalCylinder': {
      // Aire d'un segment circulaire de hauteur h, multipliée par la longueur.
      const r = tank.diameterCm / 2;
      const area = r * r * Math.acos((r - h) / r) - (r - h) * Math.sqrt(Math.max(0, 2 * r * h - h * h));
      return (area * tank.lengthCm) / 1000;
    }
    case 'table':
      return interpolate(sortedCalibration(tank.calibration), h);
    case 'gauge':
      return 0;
  }
}

function sortedCalibration(points: CalibrationPoint[]): CalibrationPoint[] {
  return points
    .filter((p) => Number.isFinite(p.heightCm) && Number.isFinite(p.liters))
    .slice()
    .sort((a, b) => a.heightCm - b.heightCm);
}

/** Interpolation linéaire ; sous le premier point, on interpole depuis (0 cm, 0 L). */
function interpolate(points: CalibrationPoint[], h: number): number {
  if (points.length === 0) {
    return 0;
  }
  const first = points[0]!;
  if (h <= first.heightCm) {
    return first.heightCm > 0 ? (first.liters * h) / first.heightCm : first.liters;
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (h <= b.heightCm) {
      return a.liters + ((b.liters - a.liters) * (h - a.heightCm)) / (b.heightCm - a.heightCm);
    }
  }
  return points.at(-1)!.liters;
}
