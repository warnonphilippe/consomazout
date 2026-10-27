import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Sous-ensemble de `safeStorage` d'Electron, injectable pour les tests. */
export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/**
 * Stockage de la clé API, chiffré par le système (Trousseau macOS / DPAPI Windows).
 * Fichier distinct des données : la clé n'est jamais exportée ni synchronisée.
 * Si le chiffrement n'est pas disponible, la clé est refusée plutôt qu'écrite en clair.
 */
export class SecretStore {
  constructor(
    private readonly path: string,
    private readonly cipher: Cipher,
  ) {}

  get encryptionAvailable(): boolean {
    return this.cipher.isEncryptionAvailable();
  }

  async hasKey(): Promise<boolean> {
    return (await this.read()) !== null;
  }

  async get(): Promise<string | null> {
    return this.read();
  }

  async set(key: string): Promise<void> {
    const trimmed = key.trim();
    if (trimmed.length < 20 || trimmed.length > 400 || /\s/.test(trimmed)) {
      throw new Error('Cette clé API n’a pas un format valide.');
    }
    if (!this.cipher.isEncryptionAvailable()) {
      throw new Error(
        'Le chiffrement du système n’est pas disponible : la clé ne peut pas être enregistrée en sécurité.',
      );
    }
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, this.cipher.encryptString(trimmed), { mode: 0o600 });
    await rename(tmp, this.path);
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }

  private async read(): Promise<string | null> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.path);
    } catch {
      return null;
    }
    try {
      return this.cipher.decryptString(encrypted);
    } catch {
      return null;
    }
  }
}
