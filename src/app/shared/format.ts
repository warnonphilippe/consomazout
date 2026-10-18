import { Pipe, type PipeTransform } from '@angular/core';
import { dayNumberToDate, toDayNumber } from '../core/calc/time';

const LOCALE = 'fr-BE';
const intFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const decFormat = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const euroFormat = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR' });
const priceFormat = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const dateFormat = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' });
const longDateFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const valid = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

export const fmt = {
  liters: (v: number | null | undefined): string => (valid(v) ? `${intFormat.format(v)} L` : '—'),
  number: (v: number | null | undefined, decimals = 0): string =>
    valid(v) ? (decimals === 1 ? decFormat.format(v) : intFormat.format(v)) : '—',
  euro: (v: number | null | undefined): string => (valid(v) ? euroFormat.format(v) : '—'),
  price: (v: number | null | undefined): string => (valid(v) ? `${priceFormat.format(v)}/L` : '—'),
  pct: (v: number | null | undefined): string => (valid(v) ? `${intFormat.format(v)} %` : '—'),
  /** Numéro de jour ou chaîne ISO locale → date courte. */
  date: (v: number | string | null | undefined): string => format(v, dateFormat),
  longDate: (v: number | string | null | undefined): string => format(v, longDateFormat),
  dateTime: (v: number | string | null | undefined): string => format(v, dateTimeFormat),
};

function format(v: number | string | null | undefined, formatter: Intl.DateTimeFormat): string {
  if (v === null || v === undefined) {
    return '—';
  }
  const day = typeof v === 'string' ? toDayNumber(v) : v;
  return Number.isFinite(day) ? formatter.format(dayNumberToDate(day)) : '—';
}

@Pipe({ name: 'liters' })
export class LitersPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return fmt.liters(value);
  }
}

@Pipe({ name: 'euro' })
export class EuroPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return fmt.euro(value);
  }
}

@Pipe({ name: 'price' })
export class PricePipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return fmt.price(value);
  }
}

@Pipe({ name: 'num' })
export class NumPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 0): string {
    return fmt.number(value, decimals);
  }
}

@Pipe({ name: 'day' })
export class DayPipe implements PipeTransform {
  transform(value: number | string | null | undefined, style: 'short' | 'long' | 'time' = 'short'): string {
    return style === 'long' ? fmt.longDate(value) : style === 'time' ? fmt.dateTime(value) : fmt.date(value);
  }
}

export const FORMAT_PIPES = [LitersPipe, EuroPipe, PricePipe, NumPipe, DayPipe] as const;
