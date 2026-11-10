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

describe('réglages de l’assistant IA', () => {
  it('ancien fichier sans moteur choisi : Claude, comme auparavant', () => {
    const { settings } = normalizeData({ settings: { aiModel: 'claude-sonnet-5-5' } });
    expect(settings.aiProvider).toBe('claude');
    expect(settings.aiModel).toBe('claude-sonnet-5-5');
    expect(settings.localModel).toBe('qwen3-4b');
    expect(settings.openaiModel).toBe('gpt-6.1-sol');
  });

  it('modèle open source local conservé', () => {
    const { settings } = normalizeData({ settings: { aiProvider: 'local', localModel: 'qwen3-8b' } });
    expect(settings.aiProvider).toBe('local');
    expect(settings.localModel).toBe('qwen3-8b');
  });

  it('valeurs inconnues remplacées par les valeurs par défaut', () => {
    const { settings } = normalizeData({
      settings: { aiProvider: 'autre', localModel: 'llama-70b', openaiModel: 'gpt-inconnu' },
    });
    expect(settings.aiProvider).toBe('claude');
    expect(settings.localModel).toBe('qwen3-4b');
    expect(settings.openaiModel).toBe('gpt-6.1-sol');
  });

  it('OpenAI conservé avec son modèle', () => {
    const { settings } = normalizeData({ settings: { aiProvider: 'openai', openaiModel: 'gpt-5.4-nano' } });
    expect(settings.aiProvider).toBe('openai');
    expect(settings.openaiModel).toBe('gpt-5.4-nano');
  });
});
