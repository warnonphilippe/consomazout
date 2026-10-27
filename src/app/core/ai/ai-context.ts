import type { FullAnalysis } from '../calc/analysis';
import { levelSeries } from '../calc/consumption';
import { UCCLE_DEGREE_DAYS } from '../calc/degree-days';
import { heightForVolume, supportsHeight, tankHeightCm } from '../calc/tank-volume';
import { dayNumberToDate, monthKey, toDayNumber, toLocalIso, yearMonthOf } from '../calc/time';
import type { AppData, Tank } from '../models/app-data.model';

const MAX_READINGS = 500;
const MAX_REFILLS = 200;

const r0 = (v: number): number => Math.round(v);
const r1 = (v: number): number => Math.round(v * 10) / 10;
const dateOf = (day: number | null): string | null => (day === null ? null : toLocalIso(dayNumberToDate(day)).slice(0, 10));

/** Hauteur correspondant à un volume (cuve décrite par ses dimensions), sinon `null`. */
function heightOf(tank: Tank | null, liters: number): number | null {
  return tank && supportsHeight(tank) ? r1(heightForVolume(tank, liters)) : null;
}

/** Instantané compact de toutes les données de l'application, joint au contexte de l'assistant. */
export function buildDataSnapshot(data: AppData, analysis: FullAnalysis, now: number): Record<string, unknown> {
  const { settings } = data;
  const tank = analysis.tank;
  const consumption = analysis.consumption;
  const intervalByTo = new Map((consumption?.intervals ?? []).map((i) => [i.to.reading.id, i]));
  const series = consumption ? levelSeries(consumption) : { points: [], refills: [] };
  const afterRefill = new Map(series.refills.map((m) => [m.refill.id, m.liters]));

  const readings = (consumption?.levels ?? []).slice(-MAX_READINGS).map((level) => {
    const interval = intervalByTo.get(level.reading.id);
    return {
      date: level.reading.date,
      mesure:
        level.reading.liters !== null
          ? { type: 'quantité lue sur la jauge', litres: level.reading.liters }
          : { type: 'hauteur mesurée', hauteurCm: level.reading.heightCm },
      contenuLitres: r0(level.liters),
      ...(interval
        ? {
            joursDepuisPrecedent: r1(interval.days),
            livreDepuisPrecedentLitres: r0(interval.refilled),
            consommeDepuisPrecedentLitres: r0(interval.consumed),
            litresParJour: interval.days >= 1 ? r1(interval.litersPerDay) : null,
            incoherence: interval.anomaly,
          }
        : {}),
      ...(level.reading.note ? { note: level.reading.note } : {}),
    };
  });

  const refills = data.refills
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_REFILLS)
    .map((r) => {
      const after = afterRefill.get(r.id);
      return {
        date: r.date,
        litres: r.liters,
        prixParLitre: r.pricePerLiter > 0 ? r.pricePerLiter : null,
        montantTotal: r.totalPrice > 0 ? r.totalPrice : null,
        ...(r.supplier ? { fournisseur: r.supplier } : {}),
        ...(r.note ? { note: r.note } : {}),
        contenuEstimeApresLivraisonLitres: after === undefined ? null : r0(after),
      };
    });

  // Niveau reconstitué à la fin de chaque mois (entre le premier et le dernier relevé).
  const monthEnds = new Map<string, { litres: number; day: number }>();
  for (const point of series.points) {
    const { year, month } = yearMonthOf(point.day - 1e-9);
    monthEnds.set(monthKey(year, month), { litres: point.liters, day: point.day });
  }
  const levelByMonth = [...monthEnds.entries()].map(([mois, p]) => ({
    mois,
    contenuFinDeMoisLitres: r0(p.litres),
    hauteurEstimeeCm: heightOf(tank, p.litres),
  }));

  const best = analysis.best;
  const forecasts = analysis.profiles.map((profile) => {
    const f = analysis.forecasts[profile.key];
    return {
      profil: profile.label,
      disponible: profile.available,
      note: profile.note,
      consommationPrevueParMoisLitres: profile.available ? profile.monthly.map(r0) : null,
      ...(f
        ? {
            contenuEstimeAujourdhuiLitres: r0(f.currentLiters),
            seuilAtteintLe: dateOf(f.alertDay),
            commanderAvantLe: dateOf(f.orderDay),
            cuveVideLe: dateOf(f.emptyDay),
            litresACommander: r0(f.litersToOrder),
            coutEstime: f.estimatedCost === null ? null : r0(f.estimatedCost),
          }
        : {}),
    };
  });

  return {
    aujourdhui: toLocalIso(dayNumberToDate(now)),
    cuve: tank
      ? {
          nom: tank.name,
          forme: tank.shape,
          dimensionsCm:
            tank.shape === 'gauge'
              ? null
              : {
                  longueur: tank.lengthCm,
                  largeur: tank.widthCm,
                  hauteur: tank.heightCm,
                  diametre: tank.diameterCm,
                  hauteurMaximaleMesurable: r1(tankHeightCm(tank)),
                },
          tableDeJaugeage: tank.shape === 'table' ? tank.calibration : null,
          nombreDeCuves: tank.count,
          capaciteTotaleLitres: r0(analysis.capacity),
          remplissageMaximalPct: tank.maxFillPct,
          remplissableLitres: r0(analysis.usableCapacity),
          erreurs: analysis.tankErrors,
        }
      : null,
    reglages: {
      consommationAnnuelleReferenceLitres: settings.referenceAnnualLiters,
      eauChaudeLitresParAn: settings.hotWaterLitersPerYear,
      seuilAlertePct: settings.alertThresholdPct,
      seuilAlerteLitres: r0(analysis.thresholdLiters),
      delaiCommandeJours: settings.orderLeadDays,
    },
    contenuEstimeAujourdhui: best
      ? {
          litres: r0(best.currentLiters),
          pctCapacite: analysis.capacity > 0 ? r0((best.currentLiters / analysis.capacity) * 100) : null,
          hauteurEstimeeCm: heightOf(tank, best.currentLiters),
          profilRetenu: best.profile.label,
        }
      : null,
    releves: readings,
    pleins: refills,
    statistiquesPleins: {
      nombre: analysis.refills.count,
      totalLitres: r0(analysis.refills.totalLiters),
      depenseTotale: r0(analysis.refills.totalCost),
      prixMoyenParLitre: analysis.refills.averagePrice,
      dernierPrixParLitre: analysis.refills.lastPrice,
    },
    niveauReconstitueFinDeMois: levelByMonth,
    consommationMensuelle: (consumption?.months ?? []).map((m) => ({
      mois: m.key,
      litres: r0(m.liters),
      complet: m.complete,
    })),
    consommationAnnuelle: analysis.years.map((y) => ({
      annee: y.year,
      litres: r0(y.total),
      complete: y.complete,
      livreLitres: r0(
        data.refills.filter((r) => r.date.startsWith(String(y.year))).reduce((s, r) => s + r.liters, 0),
      ),
    })),
    moyenneParMoisDeLAnneeLitres: analysis.averages.map((a) => (a.average === null ? null : r0(a.average))),
    saisons: analysis.seasons.map((s) => ({
      saison: s.label,
      moyenneMensuelleLitres: s.averageMonthly === null ? null : r0(s.averageMonthly),
      totalMoyenLitres: s.averageTotal === null ? null : r0(s.averageTotal),
      referenceBelgeLitres: r0(s.referenceTotal),
    })),
    derniers12Mois: analysis.last365
      ? { litres: r0(analysis.last365.liters), joursCouverts: r0(analysis.last365.coveredDays) }
      : null,
    referenceBelge: {
      consommationParMoisLitres: analysis.reference.map(r0),
      degresJoursUccleParMois: UCCLE_DEGREE_DAYS,
    },
    previsions: forecasts,
    dernierReleve: consumption?.levels.at(-1)
      ? { date: consumption.levels.at(-1)!.reading.date, joursEcoules: r0(now - consumption.levels.at(-1)!.day) }
      : null,
    prochaineLivraisonConnue:
      data.refills.map((r) => ({ r, d: toDayNumber(r.date) })).find((x) => x.d > now)?.r.date ?? null,
  };
}

const ROLE = `Tu es l'assistant d'analyse intégré à ConsoMazout, une application de suivi de la cuve à mazout (fioul de chauffage) d'une maison familiale belge : contenu de la cuve, consommation, livraisons (pleins), statistiques et prévisions de commande.

Tu as accès à toutes les données de l'application (instantané JSON ci-dessous) et tu dois t'y appuyer pour répondre. Réponds en français, de façon claire, structurée et concise ; chiffre tes réponses en litres (et en cm de hauteur quand c'est utile) et cite les dates ou périodes concernées.

Glossaire :
- Un relevé est soit une hauteur de mazout mesurée dans la cuve (convertie en litres selon la forme et les dimensions de la cuve), soit une quantité lue directement sur la jauge en litres.
- Un plein est une livraison : date, litres livrés, prix. Une note peut indiquer que la date est estimée (par exemple « livraison estimée 10 j après la commande »).
- La consommation entre deux relevés vaut : contenu au premier relevé + litres livrés entre les deux − contenu au second. Elle est ensuite répartie jour par jour selon la saison (degrés-jours normaux d'Uccle publiés par l'IRM, plus une part constante pour l'eau chaude), en s'assurant que la cuve ne descend pas sous zéro et ne déborde pas. Les mois, les niveaux de fin de mois et le contenu juste après une livraison sont donc reconstitués, pas mesurés : ils sont d'autant plus approximatifs que les relevés sont espacés.
- Une « incohérence » est un niveau qui monte entre deux relevés sans livraison suffisante : livraison oubliée ou erreur de mesure.
- Les mois « complets » sont entièrement couverts par des relevés ; seuls eux entrent dans les moyennes.
- La « référence belge » est une consommation annuelle type (réglable) répartie selon les degrés-jours : un ordre de grandeur, pas une mesure.
- Les prévisions suivent trois profils : statistique belge, statistique ajustée (référence recalée sur la consommation observée) et historique de la maison (moyenne réelle de chaque mois, disponible quand chaque mois a été couvert). « commanderAvantLe » = date d'atteinte du seuil d'alerte moins le délai de livraison ; « profilRetenu » est le meilleur profil disponible.

Règles : ne devine pas ; si une donnée manque ou est trop incertaine, dis-le et indique quelle mesure la préciserait (par exemple un relevé juste après une livraison). Signale les relevés suspects ou les longues périodes sans relevé. Donne des conseils concrets (quand commander, comment réduire la consommation, fréquence des relevés) sans promettre d'économies précises ni donner de conseil financier garanti.`;

/** Contexte complet (rôle + données) passé en `system` à Claude. */
export function buildSystemPrompt(data: AppData, analysis: FullAnalysis, now: number): string {
  return `${ROLE}\n\n<donnees>\n${JSON.stringify(buildDataSnapshot(data, analysis, now))}\n</donnees>`;
}
