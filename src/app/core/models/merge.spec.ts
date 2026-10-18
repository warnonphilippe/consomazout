import { DEFAULT_TANK, emptyData, type AppData, type Reading, type Refill } from './app-data.model';
import { mergeData } from './merge';

const reading = (id: string, date: string, heightCm: number, note = ''): Reading => ({ id, date, heightCm, note });
const refill = (id: string, date: string, liters: number, pricePerLiter = 1): Refill => ({
  id,
  date,
  liters,
  pricePerLiter,
  totalPrice: liters * pricePerLiter,
  supplier: '',
  note: '',
});
const data = (patch: Partial<AppData>): AppData => ({ ...emptyData(), tank: DEFAULT_TANK, ...patch });

describe('mergeData', () => {
  it('ajoute les relevés et pleins absents sans toucher aux données locales', () => {
    const local = data({
      readings: [reading('a', '2026-01-01T09:00', 80)],
      refills: [refill('p1', '2025-12-01T10:00', 1500)],
    });
    const incoming = data({
      readings: [reading('a', '2026-01-01T09:00', 80), reading('b', '2026-01-10T09:00', 75)],
      refills: [refill('p2', '2026-01-05T10:00', 500, 1.1)],
    });
    const { data: merged, report } = mergeData(local, incoming);
    expect(merged.readings.map((r) => r.id)).toEqual(['a', 'b']);
    expect(merged.refills.map((r) => r.id)).toEqual(['p1', 'p2']);
    expect(report).toMatchObject({ addedReadings: 1, addedRefills: 1, duplicateReadings: 1, duplicateRefills: 0, conflicts: 0 });
  });

  it('garde la version locale en cas de conflit sur un même identifiant', () => {
    const local = data({ readings: [reading('a', '2026-01-01T09:00', 80, 'local')] });
    const incoming = data({ readings: [reading('a', '2026-01-01T09:00', 79, 'autre Mac')] });
    const { data: merged, report } = mergeData(local, incoming);
    expect(merged.readings).toEqual(local.readings);
    expect(report.conflicts).toBe(1);
    expect(report.addedReadings).toBe(0);
  });

  it('reconnaît un même relevé encodé séparément sur les deux ordinateurs', () => {
    const local = data({ readings: [reading('x', '2026-02-01T08:00', 60)], refills: [refill('y', '2026-02-02T08:00', 900)] });
    const incoming = data({ readings: [reading('z', '2026-02-01T08:00', 60)], refills: [refill('w', '2026-02-02T08:00', 900)] });
    const { data: merged, report } = mergeData(local, incoming);
    expect(merged.readings).toHaveLength(1);
    expect(merged.refills).toHaveLength(1);
    expect(report.duplicateReadings).toBe(1);
    expect(report.duplicateRefills).toBe(1);
  });

  it('conserve la cuve et les réglages locaux', () => {
    const local = data({ settings: { ...emptyData().settings, referenceAnnualLiters: 1500, theme: 'dark' } });
    const incoming = data({ tank: { ...DEFAULT_TANK, lengthCm: 999 }, settings: { ...emptyData().settings, theme: 'light' } });
    const { data: merged, report } = mergeData(local, incoming);
    expect(merged.tank).toEqual(DEFAULT_TANK);
    expect(merged.settings).toEqual(local.settings);
    expect(report.tankDiffers).toBe(true);
    expect(report.tankAdopted).toBe(false);
  });

  it('reprend la cuve du fichier si aucune cuve locale', () => {
    const local = { ...emptyData() };
    const incoming = data({ tank: { ...DEFAULT_TANK, name: 'Cave' }, readings: [reading('a', '2026-01-01T09:00', 80)] });
    const { data: merged, report } = mergeData(local, incoming);
    expect(merged.tank?.name).toBe('Cave');
    expect(report.tankAdopted).toBe(true);
    expect(merged.readings).toHaveLength(1);
  });

  it('les doublons à l’intérieur du fichier ne sont ajoutés qu’une fois', () => {
    const incoming = data({ readings: [reading('a', '2026-01-01T09:00', 80), reading('b', '2026-01-01T09:00', 80)] });
    const { report } = mergeData(data({}), incoming);
    expect(report.addedReadings).toBe(1);
    expect(report.duplicateReadings).toBe(1);
  });
});
