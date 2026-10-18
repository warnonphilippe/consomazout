/**
 * Le temps est manipulé en « numéros de jour » : nombre (fractionnaire) de jours depuis
 * le 1er janvier 1970, calculé sur la date et l'heure locales comme si elles étaient en UTC.
 * Les changements d'heure n'introduisent ainsi aucun décalage dans les calculs journaliers.
 */

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DDTHH:mm` (ou `YYYY-MM-DD`) → numéro de jour. */
export function toDayNumber(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  if (!match) {
    return Number.NaN;
  }
  const [, y, mo, d, h, mi] = match;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0)) / MS_PER_DAY;
}

export function dateToDayNumber(date: Date): number {
  return (
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()) / MS_PER_DAY
  );
}

/** Numéro de jour → `Date` locale (pour l'affichage et les axes de graphiques). */
export function dayNumberToDate(day: number): Date {
  const u = new Date(Math.round(day * MS_PER_DAY));
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes());
}

/** Année et mois (0-11) du jour donné. */
export function yearMonthOf(day: number): { year: number; month: number } {
  const u = new Date(Math.floor(day) * MS_PER_DAY);
  return { year: u.getUTCFullYear(), month: u.getUTCMonth() };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** Date locale → `YYYY-MM-DDTHH:mm`. */
export function toLocalIso(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export const MONTH_LABELS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
] as const;

export const MONTH_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] as const;
