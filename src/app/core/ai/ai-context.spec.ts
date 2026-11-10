import { analyze } from '../calc/analysis';
import { buildDemoData } from '../calc/demo-data';
import { toDayNumber, toLocalIso } from '../calc/time';
import { DEFAULT_SETTINGS, DEFAULT_TANK, type AppData } from '../models/app-data.model';
import { COMPACT_LIMITS, FULL_LIMITS, buildDataSnapshot, buildSystemPrompt } from './ai-context';

describe('contexte de l’assistant', () => {
  const now = toDayNumber('2026-10-18T12:00');
  const data = buildDemoData(new Date(2026, 9, 18, 12, 0));
  data.readings.push({ id: 'jauge', date: '2026-10-17T08:00', heightCm: null, liters: 800, note: 'lu sur la jauge' });
  const analysis = analyze(data, now);

  it('contient toutes les données : cuve, relevés, pleins, statistiques et prévisions', () => {
    const snapshot = buildDataSnapshot(data, analysis, now) as Record<string, any>;
    expect(snapshot['cuve'].capaciteTotaleLitres).toBeGreaterThan(3000);
    expect(snapshot['releves']).toHaveLength(data.readings.length);
    expect(snapshot['pleins']).toHaveLength(data.refills.length);
    expect(snapshot['pleins'][0].contenuEstimeApresLivraisonLitres).toBeGreaterThan(0);
    expect(snapshot['consommationMensuelle'].length).toBeGreaterThan(20);
    expect(snapshot['previsions']).toHaveLength(3);
    expect(snapshot['previsions'].find((p: any) => p.profil === 'Historique de la maison').commanderAvantLe).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
    expect(snapshot['contenuEstimeAujourdhui'].hauteurEstimeeCm).toBeGreaterThan(0);
    expect(snapshot['niveauReconstitueFinDeMois'][0]).toHaveProperty('hauteurEstimeeCm');
  });

  it('distingue les relevés en hauteur et en litres', () => {
    const snapshot = buildDataSnapshot(data, analysis, now) as Record<string, any>;
    const gauge = snapshot['releves'].find((r: any) => r.note === 'lu sur la jauge');
    expect(gauge.mesure).toEqual({ type: 'quantité lue sur la jauge', litres: 800 });
    expect(snapshot['releves'][0].mesure.type).toBe('hauteur mesurée');
  });

  it('rôle en français puis données JSON délimitées', () => {
    const system = buildSystemPrompt(data, analysis, now);
    expect(system).toContain('ConsoMazout');
    const json = system.slice(system.indexOf('<donnees>') + 9, system.indexOf('</donnees>'));
    expect(JSON.parse(json).cuve.nom).toBe(data.tank!.name);
  });

  it('fonctionne sans cuve ni relevé', () => {
    const empty: AppData = { schemaVersion: 1, tank: null, readings: [], refills: [], settings: DEFAULT_SETTINGS };
    const snapshot = buildDataSnapshot(empty, analyze(empty, now), now) as Record<string, any>;
    expect(snapshot['cuve']).toBeNull();
    expect(snapshot['releves']).toEqual([]);
    const gaugeTank: AppData = { ...empty, tank: { ...DEFAULT_TANK, shape: 'gauge', capacityLiters: 2000 } };
    expect((buildDataSnapshot(gaugeTank, analyze(gaugeTank, now), now) as any).cuve.dimensionsCm).toBeNull();
  });

  it('limites par défaut : celles de Claude, inchangées', () => {
    expect(FULL_LIMITS).toEqual({ readings: 500, refills: 200 });
    expect(buildSystemPrompt(data, analysis, now)).toBe(buildSystemPrompt(data, analysis, now, FULL_LIMITS));
  });

  it('contexte compact pour un modèle local : relevés et pleins les plus récents seulement', () => {
    const many: AppData = {
      ...data,
      readings: Array.from({ length: 150 }, (_, i) => ({
        id: `r${i}`,
        date: toLocalIso(new Date(2026, 0, 1 + i, 8, 0)),
        heightCm: null,
        liters: 2000 - i * 5,
        note: '',
      })),
    };
    const snapshot = buildDataSnapshot(many, analyze(many, now), now, COMPACT_LIMITS) as Record<string, any>;
    expect(snapshot['releves']).toHaveLength(COMPACT_LIMITS.readings);
    expect(snapshot['releves'].at(-1).date).toBe(many.readings.at(-1)!.date);
    const full = buildSystemPrompt(many, analyze(many, now), now);
    const compact = buildSystemPrompt(many, analyze(many, now), now, COMPACT_LIMITS);
    expect(compact.length).toBeLessThan(full.length);
    expect(compact.startsWith(full.slice(0, full.indexOf('<donnees>')))).toBe(true);
  });
});
