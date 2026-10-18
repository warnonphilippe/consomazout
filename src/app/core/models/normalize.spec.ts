import { normalizeData } from './normalize';

describe('normalizeData', () => {
  it('relit un ancien fichier (relevés en hauteur seulement)', () => {
    const data = normalizeData({
      tank: { name: 'Cave', shape: 'rectangular', lengthCm: 100, widthCm: 100, heightCm: 100 },
      readings: [{ id: 'a', date: '2025-01-01T09:00', heightCm: 42, note: '' }],
    });
    expect(data.readings).toEqual([{ id: 'a', date: '2025-01-01T09:00', heightCm: 42, liters: null, note: '' }]);
    expect(data.tank?.capacityLiters).toBe(3000);
  });

  it('accepte les relevés en litres et la cuve à jauge', () => {
    const data = normalizeData({
      tank: { shape: 'gauge', capacityLiters: 2200 },
      readings: [
        { id: 'b', date: '2025-02-01T09:00', heightCm: null, liters: 1500 },
        { id: 'c', date: '2025-02-02' },
      ],
    });
    expect(data.tank?.shape).toBe('gauge');
    expect(data.tank?.capacityLiters).toBe(2200);
    expect(data.readings).toEqual([{ id: 'b', date: '2025-02-01T09:00', heightCm: null, liters: 1500, note: '' }]);
  });
});
