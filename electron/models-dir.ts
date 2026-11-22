import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * Dossier des modèles GGUF, éventuellement partagé entre applications (ConsoElec, ConsoMazout,
 * Assistant RAG, Plan Rando) pour ne télécharger qu'une fois un même fichier.
 *
 * Ordre de résolution :
 *  1. variable d'environnement `LOCAL_MODELS_DIR` ;
 *  2. clé `modelsDir` du fichier `~/.config/local-models/config.json` (commun à toutes les applications) ;
 *  3. sinon le dossier propre à l'application (`userData/models`), comportement historique.
 *
 * Les chemins doivent être absolus (`~` est accepté) ; une valeur vide, relative ou un fichier illisible
 * sont ignorés au profit de l'étape suivante.
 */
export const MODELS_DIR_ENV = 'LOCAL_MODELS_DIR';

export interface ModelsDirSources {
  env?: Record<string, string | undefined>;
  home?: string;
  readFile?: (path: string) => string;
}

/** Fichier de configuration commun : `~/.config/local-models/config.json`. */
export function sharedModelsConfigFile(home: string = homedir()): string {
  return join(home, '.config', 'local-models', 'config.json');
}

export function resolveModelsDir(defaultDir: string, sources: ModelsDirSources = {}): string {
  const env = sources.env ?? process.env;
  const home = sources.home ?? homedir();
  const read = sources.readFile ?? ((path: string) => readFileSync(path, 'utf8'));

  const fromEnv = toAbsolute(env[MODELS_DIR_ENV], home);
  if (fromEnv) return fromEnv;

  try {
    const config = JSON.parse(read(sharedModelsConfigFile(home))) as { modelsDir?: unknown } | null;
    const fromConfig = toAbsolute(typeof config?.modelsDir === 'string' ? config.modelsDir : undefined, home);
    if (fromConfig) return fromConfig;
  } catch {
    // Pas de configuration commune (ou fichier invalide) : dossier propre à l'application.
  }
  return defaultDir;
}

function toAbsolute(value: string | undefined, home: string): string | null {
  const v = value?.trim();
  if (!v) return null;
  const expanded = v === '~' ? home : /^~[\\/]/.test(v) ? join(home, v.slice(2)) : v;
  return isAbsolute(expanded) ? resolve(expanded) : null;
}
