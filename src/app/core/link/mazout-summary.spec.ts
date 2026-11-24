import { analyze } from '../calc/analysis';
import { buildDemoData } from '../calc/demo-data';
import { dateToDayNumber } from '../calc/time';
import { emptyData } from '../models/app-data.model';
import { normalizeData } from '../models/normalize';
import { asElecSummary, asMazoutSummary, MAZOUT_KWH_PER_LITER, summaryFingerprint } from './household-summary';
import { buildMazoutSummary } from './mazout-summary';

const NOW = new Date('2025-06-15T12:00:00');
const DAY = dateToDayNumber(NOW);

describe('résumé ConsoMazout partagé', () => {
  it('résume l’estimation annuelle en litres et en kWh', () => {
    const data = buildDemoData(NOW);
    const analysis = analyze(data, DAY);
    const summary = buildMazoutSummary(data, analysis, NOW)!;
    expect(summary.application).toBe('consomazout');
    expect(summary.estimationAnnuelle.source).toBe('prevision');
    expect(summary.estimationAnnuelle.litres).toBeGreaterThan(0);
    expect(summary.estimationAnnuelle.equivalentKwh).toBeCloseTo(
      summary.estimationAnnuelle.litres * MAZOUT_KWH_PER_LITER,
      -1,
    );
    expect(summary.previsionParMoisLitres).toHaveLength(12);
    expect(summary.consommationMensuelle.length).toBeLessThanOrEqual(24);
    expect(summary.cuve?.capaciteLitres).toBeGreaterThan(0);
    expect(summary.eauChaudeLitresParAn).toBe(data.settings.hotWaterLitersPerYear);
    expect(asMazoutSummary(JSON.parse(JSON.stringify(summary)))).not.toBeNull();
    expect(asElecSummary(summary)).toBeNull();
  });

  it('ne publie rien sans relevé', () => {
    const data = emptyData();
    expect(buildMazoutSummary(data, analyze(data, DAY), NOW)).toBeNull();
  });

  it('compare deux résumés sans tenir compte de la date de publication', () => {
    const data = buildDemoData(NOW);
    const analysis = analyze(data, DAY);
    expect(summaryFingerprint(buildMazoutSummary(data, analysis, NOW)!)).toBe(
      summaryFingerprint(buildMazoutSummary(data, analysis, new Date('2025-07-01T00:00:00'))!),
    );
  });

  it('conserve le drapeau des données de démonstration', () => {
    expect(normalizeData({ ...buildDemoData(NOW), demo: true }).demo).toBe(true);
    expect(normalizeData(buildDemoData(NOW)).demo).toBeUndefined();
  });
});
