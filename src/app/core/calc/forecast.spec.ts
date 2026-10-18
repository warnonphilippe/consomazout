import { DEFAULT_SETTINGS, DEFAULT_TANK, type AppData } from '../models/app-data.model';
import { analyze } from './analysis';
import { buildDemoData } from './demo-data';
import { simulate, type ForecastProfile } from './forecast';
import { toDayNumber } from './time';

const flat = (litersPerMonth: number): ForecastProfile => ({
  key: 'reference',
  label: 'test',
  monthly: Array.from({ length: 12 }, () => litersPerMonth),
  available: true,
  note: '',
});

describe('forecast', () => {
  it('date du seuil et date de commande cohérentes avec le profil', () => {
    // 31 L/mois en janvier = 1 L/jour ; on part de 120 L, seuil 100 L → 20 jours.
    const start = toDayNumber('2025-01-01T00:00');
    const f = simulate(flat(31), {
      start: { day: start, liters: 120 },
      refillsAfterStart: [],
      now: start,
      horizonDays: 25,
      thresholdLiters: 100,
      usableCapacity: 1000,
      leadDays: 7,
      lastPrice: 1.1,
    });
    expect(f.alertDay).toBeCloseTo(start + 20, 6);
    expect(f.orderDay).toBeCloseTo(start + 13, 6);
    expect(f.emptyDay).toBeNull();
    expect(f.litersToOrder).toBe(900);
    expect(f.estimatedCost).toBeCloseTo(990);
  });

  it('niveau actuel estimé et plein après le dernier relevé', () => {
    const start = toDayNumber('2025-01-01T00:00');
    const f = simulate(flat(31), {
      start: { day: start, liters: 200 },
      refillsAfterStart: [
        {
          day: start + 5,
          refill: { id: 'x', date: '', liters: 500, pricePerLiter: 1, totalPrice: 500, supplier: '', note: '' },
        },
      ],
      now: start + 10,
      horizonDays: 5,
      thresholdLiters: 50,
      usableCapacity: 1000,
      leadDays: 7,
      lastPrice: null,
    });
    expect(f.currentLiters).toBeCloseTo(690, 6);
  });

  it('analyse complète des données de démo', () => {
    const now = new Date(2026, 9, 18, 12, 0);
    const data = buildDemoData(now);
    const result = analyze(data, toDayNumber('2026-10-18T12:00'));
    expect(result.tankErrors).toEqual([]);
    expect(result.profiles.every((p) => p.available)).toBe(true);
    expect(result.best?.profile.key).toBe('history');
    const year = result.years.find((y) => y.complete);
    expect(year).toBeDefined();
    expect(year!.total).toBeGreaterThan(1800);
    expect(year!.total).toBeLessThan(2700);
    expect(result.best!.alertDay).not.toBeNull();
  });

  it('sans relevé : pas de prévision, mais le profil de référence existe', () => {
    const data: AppData = { schemaVersion: 1, tank: DEFAULT_TANK, readings: [], refills: [], settings: DEFAULT_SETTINGS };
    const result = analyze(data, toDayNumber('2026-10-18'));
    expect(result.best).toBeNull();
    expect(result.profiles.find((p) => p.key === 'history')!.available).toBe(false);
  });
});
