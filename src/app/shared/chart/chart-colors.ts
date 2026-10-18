import type { EffectiveTheme } from '../../core/services/theme.service';

/** Couleurs des graphiques, alignées sur les tokens de `styles.css`. */
export interface ChartColors {
  readonly text: string;
  readonly muted: string;
  readonly grid: string;
  readonly surface: string;
  readonly real: string;
  readonly reference: string;
  readonly adjusted: string;
  readonly history: string;
  readonly threshold: string;
  readonly capacity: string;
  readonly refill: string;
  readonly years: readonly string[];
}

const DARK: ChartColors = {
  text: '#e2e8f0',
  muted: '#94a3b8',
  grid: 'rgba(148, 163, 184, 0.12)',
  surface: '#1e293b',
  real: '#3b82f6',
  reference: '#f59e0b',
  adjusted: '#a78bfa',
  history: '#10b981',
  threshold: '#ef4444',
  capacity: '#64748b',
  refill: '#22d3ee',
  years: ['#3b82f6', '#10b981', '#f59e0b', '#a78bfa', '#f472b6', '#22d3ee', '#94a3b8'],
};

const LIGHT: ChartColors = {
  text: '#0f172a',
  muted: '#475569',
  grid: 'rgba(15, 23, 42, 0.08)',
  surface: '#ffffff',
  real: '#2563eb',
  reference: '#d97706',
  adjusted: '#7c3aed',
  history: '#059669',
  threshold: '#dc2626',
  capacity: '#64748b',
  refill: '#0891b2',
  years: ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#64748b'],
};

export function chartColors(theme: EffectiveTheme): ChartColors {
  return theme === 'dark' ? DARK : LIGHT;
}

/** Couleur avec transparence (`#rrggbb` → `rgba`). */
export function alpha(hex: string, opacity: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** Légende commune : en bas, pastilles rondes, cliquable pour masquer une série. */
export function chartLegend(c: ChartColors) {
  return {
    position: 'bottom' as const,
    labels: { color: c.text, usePointStyle: true, pointStyleWidth: 14, boxHeight: 8, padding: 14 },
  };
}
