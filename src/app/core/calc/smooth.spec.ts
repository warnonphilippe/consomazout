import { UCCLE_DEGREE_DAYS } from './degree-days';
import { smoothMonthlyProfile } from './smooth';
import { daysInMonth, toDayNumber } from './time';

const monthSum = (daily: (day: number) => number, year: number, month: number): number => {
  const first = Date.UTC(year, month, 1) / 86_400_000;
  let sum = 0;
  for (let d = 0; d < daysInMonth(year, month); d++) {
    sum += daily(first + d);
  }
  return sum;
};

describe('smoothMonthlyProfile', () => {
  const daily = smoothMonthlyProfile(UCCLE_DEGREE_DAYS);

  it('conserve exactement le total de chaque mois (année normale et bissextile)', () => {
    for (const year of [2023, 2024]) {
      UCCLE_DEGREE_DAYS.forEach((total, month) => {
        expect(monthSum(daily, year, month)).toBeCloseTo(total, 6);
      });
    }
  });

  it('pas de cassure au 1er du mois : la variation y reste du même ordre que dans le mois', () => {
    const start = toDayNumber('2025-01-01');
    const values = Array.from({ length: 365 }, (_, i) => daily(start + i));
    const steps = values.slice(1).map((v, i) => Math.abs(v - values[i]!));
    const typical = [...steps].sort((a, b) => a - b)[Math.floor(steps.length * 0.9)]!;
    expect(Math.max(...steps)).toBeLessThan(typical * 3);
    // Avant, l'écart entre le 31 mars et le 1er avril valait 8,3 − 5,4 ≈ 2,9 degrés-jours.
    const marchToApril = Math.abs(daily(toDayNumber('2025-04-01')) - daily(toDayNumber('2025-03-31')));
    expect(marchToApril).toBeLessThan(0.3);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
  });

  it('un profil déjà constant jour par jour reste constant', () => {
    const constant = smoothMonthlyProfile([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
    for (const date of ['2025-01-01', '2025-02-14', '2025-06-30', '2025-12-31']) {
      expect(constant(toDayNumber(date))).toBeCloseTo(1, 9);
    }
  });
});
