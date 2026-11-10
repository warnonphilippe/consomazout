import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Sous-ensemble de `safeStorage` d'Electron, injectable pour les tests. */
export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/**
 * Secrets rangés dans un fichier chiffré par le système (`safeStorage` : DPAPI sous Windows). Sert de repli là où le
 * Trousseau macOS n'existe pas. Fichier distinct des données : jamais exporté ni synchronisé. Si le chiffrement
 * n'est pas disponible, l'écriture est refusée plutôt que faite en clair.
 */
export class EncryptedFileSecrets {
  constructor(
    private readonly path: string,
    private readonly cipher: Cipher,
  ) {}

  async read(name: string): Promise<string | null> {
    return (await this.readAll())[name] ?? null;
  }

  async write(name: string, value: string): Promise<void> {
    await this.save({ ...(await this.readAll()), [name]: value });
  }

  async remove(name: string): Promise<void> {
    const all = await this.readAll();
    delete all[name];
    if (Object.keys(all).length === 0) {
      await rm(this.path, { force: true });
    } else {
      await this.save(all);
    }
  }

  private async save(all: Record<string, string>): Promise<void> {
    if (!this.cipher.isEncryptionAvailable()) {
      throw new Error(
        'Le chiffrement du système n’est pas disponible : la clé ne peut pas être enregistrée en sécurité.',
      );
    }
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, this.cipher.encryptString(JSON.stringify(all)), { mode: 0o600 });
    await rename(tmp, this.path);
  }

  private async readAll(): Promise<Record<string, string>> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.path);
    } catch {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(this.cipher.decryptString(encrypted));
      return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
}
