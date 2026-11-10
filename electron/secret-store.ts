import { Keychain, isSafeSecret, type KeychainItem } from './keychain';
import { readLegacySecret, removeLegacySecret } from './legacy-secrets';
import type { Cipher, EncryptedFileSecrets } from './secrets';

export type SecretName = 'claudeApiKey' | 'openaiApiKey';

export const SECRET_NAMES: readonly SecretName[] = ['claudeApiKey', 'openaiApiKey'];

/** Où les secrets sont rangés : lecture, écriture et suppression par nom. */
export interface SecretBackend {
  /** `keychain` : Trousseau macOS ; `file` : fichier chiffré par le système (hors macOS). */
  readonly kind: 'keychain' | 'file';
  read(name: SecretName): Promise<string | null>;
  write(name: SecretName, value: string): Promise<void>;
  remove(name: SecretName): Promise<void>;
}

const SERVICE = 'io.github.warnonphilippe.consomazout';
const ITEMS: Record<SecretName, KeychainItem> = {
  claudeApiKey: { service: SERVICE, account: 'claude-api-key', label: 'ConsoMazout — clé API Claude' },
  openaiApiKey: { service: SERVICE, account: 'openai-api-key', label: 'ConsoMazout — clé API OpenAI' },
};

/** Trousseau macOS : un élément visible dans Trousseau d'accès par secret. */
export function keychainBackend(keychain = new Keychain()): SecretBackend {
  return {
    kind: 'keychain',
    read: (name) => keychain.get(ITEMS[name]),
    write: (name, value) => keychain.set(ITEMS[name], value),
    remove: (name) => keychain.delete(ITEMS[name]),
  };
}

/** Repli hors macOS : fichier chiffré par le système. */
export function fileBackend(file: EncryptedFileSecrets): SecretBackend {
  return {
    kind: 'file',
    read: (name) => file.read(name),
    write: (name, value) => file.write(name, value),
    remove: (name) => file.remove(name),
  };
}

/** Anciens fichiers `safeStorage` (un par clé) à reprendre. */
export interface LegacyFiles {
  readonly cipher: Cipher;
  readonly paths: Readonly<Record<SecretName, string>>;
}

/**
 * Clés de l'application (Claude, OpenAI), lues au démarrage et gardées en mémoire pour le process principal ; elles
 * ne sont jamais renvoyées à la page.
 */
export class Secrets {
  private readonly cache = new Map<SecretName, string>();

  constructor(
    private readonly backend: SecretBackend,
    /** Ancien stockage (fichiers `safeStorage`), repris une fois puis supprimé. */
    private readonly legacy?: LegacyFiles,
  ) {}

  /** Le stockage garde les clés en sécurité (toujours vrai pour le Trousseau ; fichier : selon le système). */
  get encryptionAvailable(): boolean {
    return this.backend.kind === 'keychain' || (this.legacy?.cipher.isEncryptionAvailable() ?? true);
  }

  /** Lit toutes les clés ; une erreur de lecture laisse la clé absente. */
  async load(): Promise<void> {
    for (const name of SECRET_NAMES) {
      const value = await this.backend.read(name).catch(() => null);
      if (value) {
        this.cache.set(name, value);
      } else {
        this.cache.delete(name);
      }
    }
  }

  /**
   * Reprise unique des anciens fichiers `safeStorage` : la clé est rangée dans le nouveau stockage puis le fichier est
   * supprimé. Si elle y est déjà, l'ancien fichier est simplement supprimé ; s'il est illisible, il est conservé.
   * Renvoie les noms des clés reprises.
   */
  async migrateLegacy(): Promise<SecretName[]> {
    if (!this.legacy) {
      return [];
    }
    const migrated: SecretName[] = [];
    for (const name of SECRET_NAMES) {
      const path = this.legacy.paths[name];
      const old = await readLegacySecret(path, this.legacy.cipher);
      if (old === null) {
        continue;
      }
      try {
        if (!this.has(name)) {
          await this.set(name, old);
          migrated.push(name);
        }
        await removeLegacySecret(path);
      } catch {
        // Écriture impossible (Trousseau verrouillé…) : l'ancien fichier reste, nouvel essai au prochain démarrage.
      }
    }
    return migrated;
  }

  get(name: SecretName): string | null {
    return this.cache.get(name) ?? null;
  }

  has(name: SecretName): boolean {
    return this.cache.has(name);
  }

  /** Enregistre (espaces retirés) ou efface une clé. */
  async set(name: SecretName, value: string | null): Promise<void> {
    const cleaned = (value ?? '').replace(/\s+/g, '');
    if (cleaned === '') {
      await this.backend.remove(name);
      this.cache.delete(name);
      return;
    }
    if (!isSafeSecret(cleaned)) {
      throw new Error('Cette clé API n’a pas un format valide.');
    }
    await this.backend.write(name, cleaned);
    this.cache.set(name, cleaned);
  }
}
