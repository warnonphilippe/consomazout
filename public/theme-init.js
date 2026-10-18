// Applique le thème du système avant le démarrage d'Angular (évite un flash de couleur).
document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
