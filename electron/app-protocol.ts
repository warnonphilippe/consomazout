import { extname, join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP_SCHEME = 'app';
export const APP_HOST = 'consomazout';

/**
 * Associe une URL `app://consomazout/...` à un fichier du build Angular.
 * Tout chemin qui sort de la racine, ou qui ne désigne pas un fichier (route Angular),
 * renvoie `index.html`.
 */
export function resolveAssetPath(root: string, requestUrl: string): string {
  const index = join(root, 'index.html');
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUrl).pathname);
  } catch {
    return index;
  }
  const file = normalize(join(root, pathname));
  const inside = file.startsWith(root + sep);
  return inside && extname(file) !== '' ? file : index;
}

export function assetFileUrl(root: string, requestUrl: string): string {
  return pathToFileURL(resolveAssetPath(root, requestUrl)).toString();
}

/** Politique de sécurité du contenu ; les styles en ligne sont requis par Angular et Chart.js. */
export function buildContentSecurityPolicy(devOrigin: string | null): string {
  const connect = ["'self'"];
  if (devOrigin !== null) {
    connect.push(devOrigin, devOrigin.replace(/^http/, 'ws'));
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ');
}
