import { readFile, rm } from 'node:fs/promises';
import type { Cipher } from './secrets';

/**
 * Anciens fichiers de clé (`secrets.bin`, `secrets-openai.bin`) : une clé brute chiffrée par `safeStorage`, un fichier
 * par clé. Lus une seule fois pour reprendre la clé dans le nouveau stockage (Trousseau macOS), puis supprimés.
 */

/** Clé contenue dans l'ancien fichier, ou `null` s'il est absent ou illisible (chiffrement changé, fichier abîmé). */
export async function readLegacySecret(path: string, cipher: Cipher): Promise<string | null> {
  let encrypted: Buffer;
  try {
    encrypted = await readFile(path);
  } catch {
    return null;
  }
  try {
    const value = cipher.decryptString(encrypted).trim();
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

export async function removeLegacySecret(path: string): Promise<void> {
  await rm(path, { force: true });
}
