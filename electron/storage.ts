import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LoadResult } from './shared/ipc-contract';

/**
 * Fichier de données JSON unique. Chaque écriture passe par un fichier temporaire
 * renommé ensuite (jamais de fichier à moitié écrit), et la version précédente
 * est conservée en `.bak`. Les écritures sont sérialisées.
 */
export class DataFileStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(readonly path: string) {}

  private get backupPath(): string {
    return `${this.path}.bak`;
  }

  async load(): Promise<LoadResult> {
    const main = await readJson(this.path);
    if (main !== undefined) {
      return { content: main, path: this.path, recoveredFromBackup: false };
    }
    const backup = await readJson(this.backupPath);
    if (backup !== undefined) {
      return { content: backup, path: this.path, recoveredFromBackup: true };
    }
    return { content: null, path: this.path, recoveredFromBackup: false };
  }

  save(content: string): Promise<void> {
    JSON.parse(content); // refuse d'écrire un contenu invalide
    const run = this.queue.then(() => this.write(content));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Lecture synchrone du thème, avant l'ouverture de la fenêtre (évite un flash de couleur). */
  readThemeSync(): unknown {
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf-8')) as { settings?: { theme?: unknown } };
      return data.settings?.theme;
    } catch {
      return undefined;
    }
  }

  private async write(content: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, content, 'utf-8');
    if (existsSync(this.path)) {
      await copyFile(this.path, this.backupPath);
    }
    await rename(tmp, this.path);
  }
}

/** Contenu du fichier s'il existe et contient du JSON valide, sinon `undefined`. */
async function readJson(path: string): Promise<string | undefined> {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const content = await readFile(path, 'utf-8');
    JSON.parse(content);
    return content;
  } catch {
    return undefined;
  }
}
