import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readLegacySecret, removeLegacySecret } from './legacy-secrets';
import type { Cipher } from './secrets';

const fakeCipher: Cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain.split('').reverse().join(''), 'utf-8'),
  decryptString: (buffer) => buffer.toString('utf-8').split('').reverse().join(''),
};

describe('ancien fichier de clé', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'consomazout-legacy-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('relit la clé, ou null si le fichier est absent ou illisible', async () => {
    const path = join(dir, 'secrets.bin');
    expect(await readLegacySecret(path, fakeCipher)).toBeNull();
    await writeFile(path, fakeCipher.encryptString('sk-ant-api03-exemple'));
    expect(await readLegacySecret(path, fakeCipher)).toBe('sk-ant-api03-exemple');
    const broken: Cipher = {
      ...fakeCipher,
      decryptString: () => {
        throw new Error('illisible');
      },
    };
    expect(await readLegacySecret(path, broken)).toBeNull();
    await removeLegacySecret(path);
    expect(existsSync(path)).toBe(false);
  });
});
