/**
 * Résumés échangés entre les applications de la maison (ConsoElec, ConsoMazout) par le dossier
 * `~/.config/conso-maison`, et lus par le serveur MCP `conso-maison`. Fichier recopié à l'identique dans les deux
 * dépôts : toute évolution du format doit y être reportée (et `schema` incrémenté si elle n'est pas compatible).
 */

export const SUMMARY_SCHEMA = 1;

/** Énergie contenue dans un litre de mazout de chauffage (pouvoir calorifique inférieur, ≈ 10 kWh/L). */
export const MAZOUT_KWH_PER_LITER = 10;

/** Au-delà, le résumé de l'autre application est signalé comme ancien. */
export const STALE_AFTER_DAYS = 60;

/** D'où vient l'estimation annuelle. */
export type EstimateSource = 'prevision' | 'derniers12Mois' | 'reference';

export interface MazoutSummary {
  readonly schema: 1;
  readonly application: 'consomazout';
  /** Date et heure de publication (ISO 8601). */
  readonly genereLe: string;
  readonly estimationAnnuelle: {
    readonly litres: number;
    readonly equivalentKwh: number;
    readonly source: EstimateSource;
    /** Profil de prévision ou période utilisée. */
    readonly detail: string;
    /** Coût d'une année au dernier prix connu (ou au prix moyen), `null` sans prix. */
    readonly coutEstime: number | null;
  };
  readonly derniers12Mois: {
    readonly litres: number;
    readonly equivalentKwh: number;
    readonly joursCouverts: number;
  } | null;
  readonly consommationAnnuelle: readonly {
    readonly annee: number;
    readonly litres: number;
    readonly complete: boolean;
  }[];
  /** 24 derniers mois reconstitués. */
  readonly consommationMensuelle: readonly {
    readonly mois: string;
    readonly litres: number;
    readonly complet: boolean;
  }[];
  /** Consommation attendue pour chaque mois de l'année (janvier → décembre), selon le profil retenu. */
  readonly previsionParMoisLitres: readonly number[] | null;
  /** Part de la consommation annuelle de référence consacrée à l'eau chaude (litres par an). */
  readonly eauChaudeLitresParAn: number;
  readonly referenceLitresParAn: number;
  readonly cuve: {
    readonly contenuEstimeLitres: number;
    readonly capaciteLitres: number;
    readonly commanderAvantLe: string | null;
  } | null;
  readonly prixParLitre: {
    readonly moyen: number | null;
    readonly dernier: number | null;
  };
  readonly dernierReleve: string | null;
}

export interface ElecSummary {
  readonly schema: 1;
  readonly application: 'consoelec';
  readonly genereLe: string;
  /** Prévision des 12 prochains mois côté compteur (kWh). */
  readonly estimationAnnuelle: {
    readonly soutirageKwh: number;
    readonly injectionKwh: number;
    readonly soutirageHpKwh: number;
    readonly soutirageHcKwh: number;
    readonly injectionHpKwh: number;
    readonly injectionHcKwh: number;
    readonly source: EstimateSource;
    readonly detail: string;
  };
  /** Même prévision avec la voiture électrique prévue, `null` sans voiture prévue. */
  readonly avecVoitureElectrique: { readonly soutirageKwh: number; readonly injectionKwh: number } | null;
  /** 12 derniers mois mesurés ; peuvent couvrir moins d'un an (voir les jours couverts). */
  readonly derniers12Mois: {
    readonly joursCouverts: number;
    readonly soutirageKwh: number;
    readonly injectionKwh: number;
    /** Jours où l'index de production est aussi connu : période des indicateurs solaires ci-dessous. */
    readonly joursCouvertsSolaire: number | null;
    readonly productionPvKwh: number | null;
    readonly autoconsommeKwh: number | null;
    readonly consommationMaisonKwh: number | null;
    readonly autarciePct: number | null;
  } | null;
  readonly annuel: readonly {
    readonly annee: number;
    readonly complete: boolean;
    readonly soutirageKwh: number;
    readonly injectionKwh: number;
    readonly productionPvKwh: number | null;
    readonly consommationMaisonKwh: number | null;
  }[];
  /** 24 derniers mois. */
  readonly mensuel: readonly {
    readonly mois: string;
    readonly complet: boolean;
    readonly soutirageKwh: number;
    readonly injectionKwh: number;
    readonly productionPvKwh: number | null;
  }[];
  /** Année de facturation en cours : soldes HP / HC de fin d'année et coût estimé, `null` sans relevé. */
  readonly anneeFacturation: {
    readonly du: string;
    readonly au: string;
    readonly soldeHpKwh: number;
    readonly soldeHcKwh: number;
    readonly coutEstime: number;
  } | null;
  readonly prixKwh: { readonly hp: number; readonly hc: number };
  readonly referenceKwhParAn: number;
  readonly maison: {
    readonly personnes: number;
    readonly surfaceM2: number;
    readonly puissancePvKwc: number;
    readonly chaudiereMazout: boolean;
    readonly poeleABois: boolean;
    readonly noteChauffage: string;
  };
  readonly dernierReleve: string | null;
}

export type HouseholdSummary = MazoutSummary | ElecSummary;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Résumé ConsoMazout reconnu (format compatible), sinon `null`. */
export function asMazoutSummary(value: unknown): MazoutSummary | null {
  return isRecord(value) &&
    value['schema'] === SUMMARY_SCHEMA &&
    value['application'] === 'consomazout' &&
    typeof value['genereLe'] === 'string' &&
    isRecord(value['estimationAnnuelle'])
    ? (value as unknown as MazoutSummary)
    : null;
}

/** Résumé ConsoElec reconnu (format compatible), sinon `null`. */
export function asElecSummary(value: unknown): ElecSummary | null {
  return isRecord(value) &&
    value['schema'] === SUMMARY_SCHEMA &&
    value['application'] === 'consoelec' &&
    typeof value['genereLe'] === 'string' &&
    isRecord(value['estimationAnnuelle'])
    ? (value as unknown as ElecSummary)
    : null;
}

/** Âge du résumé en jours entiers (0 s'il est daté dans le futur ou illisible). */
export function summaryAgeDays(summary: { readonly genereLe: string }, nowMs: number): number {
  const at = Date.parse(summary.genereLe);
  return Number.isFinite(at) ? Math.max(0, Math.floor((nowMs - at) / 86_400_000)) : 0;
}

/** Contenu comparable d'un résumé (sans la date de publication) pour n'écrire que les vrais changements. */
export function summaryFingerprint(summary: HouseholdSummary): string {
  const { genereLe: _ignored, ...rest } = summary;
  return JSON.stringify(rest);
}
