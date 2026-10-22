import { DEFAULT_TANK, type Reading, type Refill, type Tank } from '../models/app-data.model';
import { analyzeConsumption, consumptionBetween, levelSeries, type LevelPoint } from './consumption';
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

  /** Vérifie qu'entre deux points le niveau ne monte que lors d'une livraison (saut vertical). */
  const onlyRisesAtRefills = (points: LevelPoint[], refillDays: number[]): boolean =>
    points.every((p, i) => {
      const prev = points[i - 1];
      return !prev || p.liters <= prev.liters + 1e-6 || (p.day === prev.day && refillDays.includes(p.day));
    });

  it('courbe : diminution régulière puis saut vertical à la livraison', () => {
    const a = analyzeConsumption(
      tank,
      [reading('2025-01-01T09:00', 50), reading('2025-01-21T09:00', 150)],
      [refill('2025-01-10T09:00', 1300)],
      0.15,
    );
    const { points, refills } = levelSeries(a);
    const refillDay = toDayNumber('2025-01-10T09:00');
    expect(points[0]).toEqual({ day: toDayNumber('2025-01-01T09:00'), liters: 500 });
    expect(points.at(-1)!.liters).toBeCloseTo(1500, 6);
    expect(onlyRisesAtRefills(points, [refillDay])).toBe(true);
    const jump = points.findIndex((p, i) => i > 0 && p.liters > points[i - 1]!.liters);
    expect(points[jump]!.day).toBe(refillDay);
    expect(points[jump]!.liters - points[jump - 1]!.liters).toBeCloseTo(1300, 6);
    expect(refills[0]!.liters).toBeCloseTo(points[jump]!.liters, 6);
  });

  it('la cuve ne descend jamais sous zéro avant une livraison', () => {
    // 1 000 L au départ, 2 000 L livrés en septembre, 1 100 L à l'arrivée : la répartition purement
    // saisonnière viderait la cuve avant la livraison ; elle est ajustée pour rester ≥ 0.
    const a = analyzeConsumption(
      tank,
      [reading('2024-10-01T09:00', 100), reading('2026-03-01T09:00', 110)],
      [refill('2025-09-15T09:00', 2000)],
      0.15,
    );
    const { points } = levelSeries(a);
    expect(Math.min(...points.map((p) => p.liters))).toBeGreaterThanOrEqual(0);
    expect(points.at(-1)!.liters).toBeCloseTo(1100, 6);
    expect(a.intervals[0]!.segments.reduce((s, seg) => s + seg.liters, 0)).toBeCloseTo(1900, 6);
    expect(a.months.reduce((s, m) => s + m.liters, 0)).toBeCloseTo(1900, 6);
  });

  it('données réelles : cylindre couché Ø150 × 170 cm, relevés espacés et trois livraisons', () => {
    const real: Tank = { ...DEFAULT_TANK, shape: 'horizontalCylinder', diameterCm: 150, lengthCm: 170 };
    const readings = [
      reading('2024-05-25T21:18', 30),
      reading('2024-10-29T21:16', 64),
      reading('2026-03-03T21:14', 63),
      reading('2026-03-09T21:11', 61),
      reading('2026-09-30T21:11', 65),
    ];
    const deliveries = [refill('2024-05-31T21:19', 1000), refill('2025-09-15T21:15', 2000), refill('2026-03-15T21:12', 1000)];
    const a = analyzeConsumption(real, readings, deliveries, 0.15);
    const { points, refills } = levelSeries(a);
    const refillDays = deliveries.map((r) => toDayNumber(r.date));
    expect(onlyRisesAtRefills(points, refillDays)).toBe(true);
    expect(refills).toHaveLength(3);
    expect(Math.min(...points.map((p) => p.liters))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...points.map((p) => p.liters))).toBeLessThanOrEqual(3004.2);
    // Chaque relevé est bien un point de la courbe.
    for (const level of a.levels) {
      const atDay = points.filter((p) => Math.abs(p.day - level.day) < 1e-6);
      expect(atDay.some((p) => Math.abs(p.liters - level.liters) < 0.5)).toBe(true);
    }
  });
});
