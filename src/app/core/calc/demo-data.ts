import { DEFAULT_SETTINGS, type AppData, type Reading, type Refill, type Tank } from '../models/app-data.model';
import { referenceMonthlyProfile } from './degree-days';
import { capacityLiters, heightForVolume } from './tank-volume';
import { dateToDayNumber, dayNumberToDate, daysInMonth, toLocalIso, yearMonthOf } from './time';

/** Générateur pseudo-aléatoire déterministe (mulberry32) : les données de démo sont reproductibles. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deux ans et quelques mois d'historique fictif : cuve cylindrique horizontale de ~3 000 L,
 * consommation 10 % au-dessus de la référence belge, relevés tous les 7 à 14 jours,
 * plein quand la cuve descend sous ~25 %.
 */
export function buildDemoData(now: Date): AppData {
  const rnd = random(42);
  const tank: Tank = {
    name: 'Cuve cave (démo)',
    shape: 'horizontalCylinder',
    lengthCm: 230,
    widthCm: 120,
    heightCm: 130,
    diameterCm: 130,
    calibration: [],
    count: 1,
    maxFillPct: 95,
  };
  const capacity = capacityLiters(tank);
  const profile = referenceMonthlyProfile(2000 * 1.1, 300);
  const readings: Reading[] = [];
  const refills: Refill[] = [];

  const end = dateToDayNumber(now) - 2;
  let day = dateToDayNumber(new Date(now.getFullYear() - 2, now.getMonth() - 3, 1, 9, 0));
  let level = capacity * 0.4;
  let nextReading = day;
  let prices = 0.98;
  let id = 0;
  const pushReading = (at: number): void => {
    const height = Math.round(heightForVolume(tank, level) * 2) / 2;
    readings.push({ id: `demo-r${++id}`, date: toLocalIso(dayNumberToDate(at)), heightCm: height, note: '' });
  };

  while (day < end) {
    if (day >= nextReading) {
      pushReading(day);
      nextReading = day + 7 + Math.floor(rnd() * 8);
    }
    if (level < capacity * 0.25) {
      const liters = Math.round((capacity * 0.95 - level) / 50) * 50;
      prices = Math.min(1.35, Math.max(0.82, prices + (rnd() - 0.45) * 0.12));
      const pricePerLiter = Math.round(prices * 1000) / 1000;
      const at = day + 0.1;
      refills.push({
        id: `demo-p${++id}`,
        date: toLocalIso(dayNumberToDate(at)),
        liters,
        pricePerLiter,
        totalPrice: Math.round(liters * pricePerLiter * 100) / 100,
        supplier: rnd() > 0.5 ? 'Mazout Dupont' : 'Fioul Express',
        note: '',
      });
      level += liters;
      pushReading(at + 0.01);
    }
    const { year, month } = yearMonthOf(day);
    // Hivers plus ou moins rigoureux d'une année à l'autre.
    const winter = month >= 8 ? year : year - 1;
    const yearFactor = 1 + 0.12 * Math.sin(winter * 2.3);
    const daily = (profile[month]! / daysInMonth(year, month)) * yearFactor * (0.75 + rnd() * 0.5);
    level = Math.max(0, level - daily);
    day += 1;
  }
  pushReading(end);

  return { schemaVersion: 1, tank, readings, refills, settings: { ...DEFAULT_SETTINGS } };
}
