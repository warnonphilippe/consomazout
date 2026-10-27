import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretStore, type Cipher } from './secrets';

const fakeCipher = (available = true): Cipher => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from(plain.split('').reverse().join(''), 'utf-8'),
  decryptString: (buffer) => buffer.toString('utf-8').split('').reverse().join(''),
});

describe('SecretStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'consomazout-secrets-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const KEY = 'sk-ant-api03-exemple-de-cle-assez-longue';

  it('enregistre la clé chiffrée, jamais en clair', async () => {
    const store = new SecretStore(join(dir, 'secrets.bin'), fakeCipher());
    expect(await store.hasKey()).toBe(false);
    await store.set(`  ${KEY}\n`);
    expect(await store.get()).toBe(KEY);
    expect((await readFile(join(dir, 'secrets.bin'))).toString('utf-8')).not.toContain(KEY);
    await store.clear();
    expect(await store.hasKey()).toBe(false);
  });

  it('refuse une clé invalide ou sans chiffrement disponible', async () => {
    await expect(new SecretStore(join(dir, 'a.bin'), fakeCipher()).set('court')).rejects.toThrow(
      'format',
    );
    await expect(new SecretStore(join(dir, 'b.bin'), fakeCipher(false)).set(KEY)).rejects.toThrow(
      'chiffrement',
    );
  });
});
