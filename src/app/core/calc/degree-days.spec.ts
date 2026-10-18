import { referenceMonthlyProfile, seasonalWeightBetween, UCCLE_DEGREE_DAYS_YEAR } from './degree-days';
import { toDayNumber } from './time';

describe('degree-days', () => {
  it('total annuel des normales', () => {
    expect(UCCLE_DEGREE_DAYS_YEAR).toBeCloseTo(1953.1, 1);
  });

  it('profil de référence : somme = consommation annuelle, hiver >> été', () => {
    const profile = referenceMonthlyProfile(2000, 300);
    expect(profile.reduce((a, b) => a + b, 0)).toBeCloseTo(2000);
    expect(profile[0]).toBeCloseTo(25 + (1700 * 365.1) / 1953.1);
    expect(profile[0]!).toBeGreaterThan(profile[6]! * 10);
  });

  it('les poids saisonniers d’une année valent ~1', () => {
    const w = seasonalWeightBetween(toDayNumber('2025-01-01'), toDayNumber('2026-01-01'), 0.15);
    expect(w).toBeCloseTo(1, 2);
  });
});
