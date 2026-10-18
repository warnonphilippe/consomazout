import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', title: 'Tableau de bord', loadComponent: () => import('./pages/dashboard/dashboard.page') },
  { path: 'releves', title: 'Relevés', loadComponent: () => import('./pages/readings/readings.page') },
  { path: 'pleins', title: 'Pleins', loadComponent: () => import('./pages/refills/refills.page') },
  { path: 'statistiques', title: 'Statistiques', loadComponent: () => import('./pages/stats/stats.page') },
  { path: 'cuve', title: 'Cuve', loadComponent: () => import('./pages/tank/tank.page') },
  { path: 'reglages', title: 'Réglages', loadComponent: () => import('./pages/settings/settings.page') },
  { path: 'aide', title: 'Aide', loadComponent: () => import('./pages/help/help.page') },
  { path: '**', redirectTo: '' },
];
