import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * Lien entre les applications de la maison (ConsoElec, ConsoMazout) : chacune publie un résumé JSON de ses estimations
 * (consommation annuelle, 12 derniers mois…) dans un dossier commun, où l'autre application et le serveur MCP
 * `conso-maison` viennent le lire. Module recopié à l'identique dans les deux dépôts.
 *
 * Dossier : variable `CONSO_MAISON_DIR` (chemin absolu, `~` accepté), sinon `~/.config/conso-maison`, ou
 * `~/.config/conso-maison-dev` pour une application non empaquetée (les essais ne remplacent jamais les vraies données).
 */
export const LINK_DIR_ENV = 'CONSO_MAISON_DIR';

export const LINKED_APPS = ['consoelec', 'consomazout'] as const;
export type LinkedApp = (typeof LINKED_APPS)[number];

/** Taille maximale d'un résumé (le résumé réel fait quelques kilo-octets). */
export const MAX_SUMMARY_BYTES = 512 * 1024;

export interface LinkDirSources {
  env?: Record<string, string | undefined>;
  home?: string;
  /** Application de développement (non empaquetée). */
  dev?: boolean;
}

export function resolveLinkDir(sources: LinkDirSources = {}): string {
  const env = sources.env ?? process.env;
  const home = sources.home ?? homedir();
  const fromEnv = toAbsolute(env[LINK_DIR_ENV], home);
  if (fromEnv) return fromEnv;
  return join(home, '.config', sources.dev ? 'conso-maison-dev' : 'conso-maison');
}

export function isLinkedApp(value: unknown): value is LinkedApp {
  return typeof value === 'string' && (LINKED_APPS as readonly string[]).includes(value);
}

export function summaryPath(dir: string, app: LinkedApp): string {
  return join(dir, `${app}.json`);
}

/** Dossier d'échange d'une application : publie son propre résumé, lit celui des autres. */
export class HouseholdLink {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly dir: string,
    readonly self: LinkedApp,
  ) {}

  /** Écrit le résumé de l'application (JSON validé, écriture atomique, lisible par l'utilisateur seul). */
  async publish(content: string): Promise<void> {
    if (content.length > MAX_SUMMARY_BYTES) {
      throw new Error('Résumé trop volumineux.');
    }
    const parsed: unknown = JSON.parse(content);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Résumé invalide.');
    }
    const run = this.queue.then(() => this.write(content));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Résumé publié par une autre application, ou `null` (jamais publié, illisible ou invalide). */
  async read(app: LinkedApp): Promise<unknown> {
    try {
      const text = await readFile(summaryPath(this.dir, app), 'utf-8');
      if (text.length > MAX_SUMMARY_BYTES) return null;
      const parsed: unknown = JSON.parse(text);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private async write(content: string): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const target = summaryPath(this.dir, this.self);
    const tmp = `${target}.tmp`;
    await writeFile(tmp, content, { encoding: 'utf-8', mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, target);
  }
}

function toAbsolute(value: string | undefined, home: string): string | null {
  const v = value?.trim();
  if (!v) return null;
  const expanded = v === '~' ? home : /^~[\\/]/.test(v) ? join(home, v.slice(2)) : v;
  return isAbsolute(expanded) ? resolve(expanded) : null;
}
