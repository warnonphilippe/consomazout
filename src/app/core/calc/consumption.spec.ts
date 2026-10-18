import { DEFAULT_TANK, type Reading, type Refill, type Tank } from '../models/app-data.model';
import { analyzeConsumption, consumptionBetween } from './consumption';
import { toDayNumber } from './time';

// Cuve rectangulaire de 100 x 100 cm : 10 L par cm de hauteur.
const tank: Tank = { ...DEFAULT_TANK, shape: 'rectangular', lengthCm: 100, widthCm: 100, heightCm: 200 };
const reading = (date: string, heightCm: number, id = date): Reading => ({ id, date, heightCm, liters: null, note: '' });
const gauge = (date: string, liters: number, id = date): Reading => ({ id, date, heightCm: null, liters, note: '' });
const refill = (date: string, liters: number): Refill => ({
  id: date,
  date,
  liters,
  pricePerLiter: 1,
  totalPrice: liters,
  supplier: '',
  note: '',
});

describe('consumption', () => {
  it('consommation entre deux relevés', () => {
    const a = analyzeConsumption(tank, [reading('2025-01-01T10:00', 150), reading('2025-01-11T10:00', 130)], [], 0.15);
    expect(a.intervals).toHaveLength(1);
    expect(a.intervals[0]!.consumed).toBeCloseTo(200);
    expect(a.intervals[0]!.litersPerDay).toBeCloseTo(20);
  });

  it('un plein entre deux relevés est ajouté', () => {
    const a = analyzeConsumption(
      tank,
      [reading('2025-01-01T10:00', 50), reading('2025-01-21T10:00', 150)],
      [refill('2025-01-10T09:00', 1300)],
      0.15,
    );
    expect(a.intervals[0]!.refilled).toBe(1300);
    expect(a.intervals[0]!.consumed).toBeCloseTo(300);
    expect(a.intervals[0]!.anomaly).toBe(false);
  });

  it('un plein à la même heure qu’un relevé est fait avant ce relevé', () => {
    const a = analyzeConsumption(
      tank,
      [reading('2025-01-01T10:00', 50), reading('2025-01-10T10:00', 170)],
      [refill('2025-01-10T10:00', 1300)],
      0.15,
    );
    expect(a.intervals[0]!.consumed).toBeCloseTo(100);
  });

  it('signale une hausse sans plein', () => {
    const a = analyzeConsumption(tank, [reading('2025-01-01T10:00', 50), reading('2025-01-10T10:00', 100)], [], 0.15);
    expect(a.intervals[0]!.anomaly).toBe(true);
    expect(a.intervals[0]!.consumed).toBe(0);
  });

  it('répartit un long intervalle sur les mois, plus en hiver, total conservé', () => {
    const a = analyzeConsumption(tank, [reading('2025-03-01T00:00', 200), reading('2025-07-01T00:00', 100)], [], 0.15);
    const total = a.months.reduce((sum, m) => sum + m.liters, 0);
    expect(total).toBeCloseTo(1000, 6);
    const march = a.months.find((m) => m.key === '2025-03')!;
    const june = a.months.find((m) => m.key === '2025-06')!;
    expect(march.liters).toBeGreaterThan(june.liters * 3);
    expect(march.complete).toBe(true);
    expect(a.months.map((m) => m.key)).toEqual(['2025-03', '2025-04', '2025-05', '2025-06']);
  });

  it('un relevé ajouté dans le passé est pris en compte', () => {
    const readings = [reading('2025-02-01T00:00', 100, 'b'), reading('2025-01-01T00:00', 180, 'a')];
    const a = analyzeConsumption(tank, readings, [], 0.15);
    expect(a.levels.map((l) => l.reading.id)).toEqual(['a', 'b']);
    expect(a.intervals[0]!.consumed).toBeCloseTo(800);
  });

  it('consommation sur une sous-période', () => {
    const a = analyzeConsumption(tank, [reading('2025-01-01T00:00', 200), reading('2025-01-31T00:00', 140)], [], 0.15);
    const half = consumptionBetween(a, toDayNumber('2025-01-01'), toDayNumber('2025-01-16'));
    expect(half.liters).toBeCloseTo(300);
    expect(half.coveredDays).toBeCloseTo(15);
  });

  it('accepte des relevés en litres (jauge) mélangés à des relevés en hauteur', () => {
    const a = analyzeConsumption(
      tank,
      [reading('2025-01-01T09:00', 150), gauge('2025-01-11T09:00', 1300), reading('2025-01-21T09:00', 110)],
      [],
      0.15,
    );
    expect(a.levels.map((l) => l.liters)).toEqual([1500, 1300, 1100]);
    expect(a.intervals.map((i) => i.consumed)).toEqual([200, 200]);
  });

  it('plafonne une quantité supérieure à la capacité', () => {
    const a = analyzeConsumption(tank, [gauge('2025-01-01T09:00', 5000)], [], 0.15);
    expect(a.levels[0]!.liters).toBe(2000);
  });

  it('cuve à jauge : relevés en litres, hauteurs ignorées', () => {
    const gaugeTank: Tank = { ...DEFAULT_TANK, shape: 'gauge', capacityLiters: 2500 };
    const a = analyzeConsumption(
      gaugeTank,
      [gauge('2025-01-01T09:00', 2000), reading('2025-01-05T09:00', 80), gauge('2025-01-11T09:00', 1800)],
      [refill('2025-01-08T09:00', 300)],
      0.15,
    );
    expect(a.levels).toHaveLength(2);
    expect(a.intervals[0]!.consumed).toBeCloseTo(500);
  });
});
