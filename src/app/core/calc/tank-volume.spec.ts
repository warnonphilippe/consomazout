import { DEFAULT_TANK, type Tank } from '../models/app-data.model';
import { capacityLiters, heightForVolume, validateTank, volumeAt } from './tank-volume';

const tank = (patch: Partial<Tank>): Tank => ({ ...DEFAULT_TANK, ...patch });

describe('tank-volume', () => {
  it('cuve rectangulaire : volume proportionnel à la hauteur', () => {
    const t = tank({ shape: 'rectangular', lengthCm: 200, widthCm: 100, heightCm: 150 });
    expect(capacityLiters(t)).toBeCloseTo(3000);
    expect(volumeAt(t, 75)).toBeCloseTo(1500);
    expect(volumeAt(t, 200)).toBeCloseTo(3000);
    expect(volumeAt(t, -5)).toBe(0);
  });

  it('cylindre vertical', () => {
    const t = tank({ shape: 'verticalCylinder', diameterCm: 100, heightCm: 200 });
    expect(capacityLiters(t)).toBeCloseTo((Math.PI * 50 * 50 * 200) / 1000);
  });

  it('cylindre horizontal : moitié à mi-hauteur, plein au diamètre, symétrique', () => {
    const t = tank({ shape: 'horizontalCylinder', diameterCm: 130, lengthCm: 230 });
    const full = (Math.PI * 65 * 65 * 230) / 1000;
    expect(capacityLiters(t)).toBeCloseTo(full, 6);
    expect(volumeAt(t, 65)).toBeCloseTo(full / 2, 6);
    expect(volumeAt(t, 30) + volumeAt(t, 100)).toBeCloseTo(full, 6);
    expect(volumeAt(t, 20)).toBeLessThan((full * 20) / 130);
  });

  it('table de jaugeage interpolée, triée et depuis zéro', () => {
    const t = tank({
      shape: 'table',
      calibration: [
        { heightCm: 100, liters: 2000 },
        { heightCm: 10, liters: 100 },
        { heightCm: 50, liters: 900 },
      ],
    });
    expect(volumeAt(t, 5)).toBeCloseTo(50);
    expect(volumeAt(t, 30)).toBeCloseTo(500);
    expect(volumeAt(t, 75)).toBeCloseTo(1450);
    expect(capacityLiters(t)).toBe(2000);
  });

  it('batterie de cuves : multiplie le volume', () => {
    const t = tank({ shape: 'rectangular', lengthCm: 100, widthCm: 100, heightCm: 100, count: 3 });
    expect(capacityLiters(t)).toBeCloseTo(3000);
  });

  it('hauteur pour un volume (inverse)', () => {
    const t = tank({ shape: 'horizontalCylinder', diameterCm: 130, lengthCm: 230 });
    for (const h of [5, 40, 65, 110]) {
      expect(heightForVolume(t, volumeAt(t, h))).toBeCloseTo(h, 4);
    }
  });

  it('validation', () => {
    expect(validateTank(tank({ shape: 'rectangular', lengthCm: 0 }))).toHaveLength(1);
    expect(validateTank(tank({ shape: 'table', calibration: [] }))).not.toHaveLength(0);
    expect(validateTank(DEFAULT_TANK)).toEqual([]);
  });
});
