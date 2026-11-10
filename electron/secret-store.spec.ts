import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SECRET_NAMES, Secrets, fileBackend, type SecretBackend, type SecretName } from './secret-store';
import { EncryptedFileSecrets, type Cipher } from './secrets';

const fakeCipher: Cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain.split('').reverse().join(''), 'utf-8'),
  decryptString: (buffer) => buffer.toString('utf-8').split('').reverse().join(''),
};

const memoryBackend = (): SecretBackend & { store: Map<SecretName, string> } => {
  const store = new Map<SecretName, string>();
  return {
    kind: 'keychain',
    store,
    read: async (name) => store.get(name) ?? null,
    write: async (name, value) => void store.set(name, value),
    remove: async (name) => void store.delete(name),
  };
};

const CLAUDE = 'sk-ant-api03-exemple-de-cle-assez-longue';
const OPENAI = 'sk-proj-exemple-de-cle-openai-longue';

describe('Secrets', () => {
  it('lit les clés au démarrage et les garde en mémoire', async () => {
    const backend = memoryBackend();
    backend.store.set('claudeApiKey', CLAUDE);
    const secrets = new Secrets(backend);
    expect(secrets.has('claudeApiKey')).toBe(false);
    await secrets.load();
    expect(secrets.get('claudeApiKey')).toBe(CLAUDE);
    expect(secrets.get('openaiApiKey')).toBeNull();
    expect(secrets.encryptionAvailable).toBe(true);
  });

  it('enregistre sans espaces, efface avec null, refuse une clé invalide', async () => {
    const backend = memoryBackend();
    const secrets = new Secrets(backend);
    await secrets.set('claudeApiKey', `  ${CLAUDE}\n`);
    expect(backend.store.get('claudeApiKey')).toBe(CLAUDE);
    expect(secrets.get('claudeApiKey')).toBe(CLAUDE);
    await secrets.set('claudeApiKey', null);
    expect(secrets.has('claudeApiKey')).toBe(false);
    expect(backend.store.has('claudeApiKey')).toBe(false);
    await expect(secrets.set('claudeApiKey', 'court')).rejects.toThrow('format');
    await expect(secrets.set('claudeApiKey', 'x" -w "autre-valeur')).rejects.toThrow('format');
  });

  it('expose les deux clés de l’application', () => {
    expect(SECRET_NAMES).toEqual(['claudeApiKey', 'openaiApiKey']);
  });

  describe('reprise des anciens fichiers safeStorage', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'consomazout-migrate-'));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });
    const legacy = () => ({
      cipher: fakeCipher,
      paths: { claudeApiKey: join(dir, 'secrets.bin'), openaiApiKey: join(dir, 'secrets-openai.bin') },
    });

    it('range les anciennes clés dans le nouveau stockage puis supprime les fichiers', async () => {
      await writeFile(join(dir, 'secrets.bin'), fakeCipher.encryptString(CLAUDE));
      await writeFile(join(dir, 'secrets-openai.bin'), fakeCipher.encryptString(OPENAI));
      const backend = memoryBackend();
      const secrets = new Secrets(backend, legacy());
      await secrets.load();
      expect(await secrets.migrateLegacy()).toEqual(['claudeApiKey', 'openaiApiKey']);
      expect(backend.store.get('claudeApiKey')).toBe(CLAUDE);
      expect(secrets.get('openaiApiKey')).toBe(OPENAI);
      expect(existsSync(join(dir, 'secrets.bin'))).toBe(false);
      expect(existsSync(join(dir, 'secrets-openai.bin'))).toBe(false);
      expect(await secrets.migrateLegacy()).toEqual([]);
    });

    it('ne remplace pas une clé déjà présente, mais supprime l’ancien fichier', async () => {
      await writeFile(join(dir, 'secrets.bin'), fakeCipher.encryptString(CLAUDE));
      const backend = memoryBackend();
      backend.store.set('claudeApiKey', 'sk-ant-api03-cle-plus-recente-longue');
      const secrets = new Secrets(backend, legacy());
      await secrets.load();
      expect(await secrets.migrateLegacy()).toEqual([]);
      expect(secrets.get('claudeApiKey')).toBe('sk-ant-api03-cle-plus-recente-longue');
      expect(existsSync(join(dir, 'secrets.bin'))).toBe(false);
    });

    it('conserve l’ancien fichier si l’écriture échoue', async () => {
      await writeFile(join(dir, 'secrets.bin'), fakeCipher.encryptString(CLAUDE));
      const backend = memoryBackend();
      backend.write = async () => {
        throw new Error('Trousseau verrouillé');
      };
      const secrets = new Secrets(backend, legacy());
      await secrets.load();
      expect(await secrets.migrateLegacy()).toEqual([]);
      expect(existsSync(join(dir, 'secrets.bin'))).toBe(true);
    });

    it('fonctionne aussi avec le fichier chiffré (hors macOS)', async () => {
      await writeFile(join(dir, 'secrets.bin'), fakeCipher.encryptString(CLAUDE));
      const secrets = new Secrets(fileBackend(new EncryptedFileSecrets(join(dir, 'keys.bin'), fakeCipher)), legacy());
      await secrets.load();
      await secrets.migrateLegacy();
      const again = new Secrets(fileBackend(new EncryptedFileSecrets(join(dir, 'keys.bin'), fakeCipher)));
      await again.load();
      expect(again.get('claudeApiKey')).toBe(CLAUDE);
    });
  });
});
