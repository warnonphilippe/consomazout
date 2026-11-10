import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EncryptedFileSecrets, type Cipher } from './secrets';

const fakeCipher = (available = true): Cipher => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from(plain.split('').reverse().join(''), 'utf-8'),
  decryptString: (buffer) => buffer.toString('utf-8').split('').reverse().join(''),
});

describe('EncryptedFileSecrets', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'consomazout-secrets-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const KEY = 'sk-ant-api03-exemple-de-cle-assez-longue';

  it('enregistre les clés chiffrées, jamais en clair, et les supprime une à une', async () => {
    const path = join(dir, 'keys.bin');
    const file = new EncryptedFileSecrets(path, fakeCipher());
    expect(await file.read('claudeApiKey')).toBeNull();
    await file.write('claudeApiKey', KEY);
    await file.write('openaiApiKey', 'sk-proj-autre-cle-assez-longue');
    expect(await file.read('claudeApiKey')).toBe(KEY);
    expect((await readFile(path)).toString('utf-8')).not.toContain(KEY);
    await file.remove('claudeApiKey');
    expect(await file.read('claudeApiKey')).toBeNull();
    expect(await file.read('openaiApiKey')).toBe('sk-proj-autre-cle-assez-longue');
    await file.remove('openaiApiKey');
    expect(await file.read('openaiApiKey')).toBeNull();
  });

  it('refuse d’écrire sans chiffrement disponible', async () => {
    await expect(new EncryptedFileSecrets(join(dir, 'b.bin'), fakeCipher(false)).write('claudeApiKey', KEY)).rejects.toThrow(
      'chiffrement',
    );
  });
});
