import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Keychain, isSafeSecret, type KeychainItem } from './keychain';

const ITEM: KeychainItem = { service: 'io.github.warnonphilippe.consomazout.test', account: 'test', label: 'ConsoMazout — test' };

describe('isSafeSecret', () => {
  it('accepte une clé API ou une clé WPA2-PSK, refuse guillemets, espaces et valeurs trop courtes', () => {
    expect(isSafeSecret('sk-ant-api03-AbC_dEf-123456')).toBe(true);
    expect(isSafeSecret('ABCDEFGH12345678')).toBe(true);
    expect(isSafeSecret('court')).toBe(false);
    expect(isSafeSecret('avec "guillemets" dedans')).toBe(false);
    expect(isSafeSecret('ABCD EFGH 1234')).toBe(false);
  });
});

// Trousseau jetable créé pour le test : le trousseau de l'utilisateur n'est jamais touché.
describe.runIf(process.platform === 'darwin')('Keychain (trousseau temporaire)', () => {
  let dir: string;
  let path: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'consomazout-kc-'));
    path = join(dir, 'test.keychain-db');
    execFileSync('/usr/bin/security', ['create-keychain', '-p', 'test', path]);
    execFileSync('/usr/bin/security', ['unlock-keychain', '-p', 'test', path]);
  });
  afterAll(async () => {
    execFileSync('/usr/bin/security', ['delete-keychain', path]);
    await rm(dir, { recursive: true, force: true });
  });

  it('écrit, relit, remplace et supprime un élément', async () => {
    const kc = new Keychain(path);
    expect(await kc.get(ITEM)).toBeNull();
    await kc.set(ITEM, 'ABCDEFGH12345678');
    expect(await kc.get(ITEM)).toBe('ABCDEFGH12345678');
    await kc.set(ITEM, 'sk-ant-api03-AbC_dEf-123456');
    expect(await kc.get(ITEM)).toBe('sk-ant-api03-AbC_dEf-123456');
    await kc.delete(ITEM);
    expect(await kc.get(ITEM)).toBeNull();
    await kc.delete(ITEM);
  });

  it('refuse une valeur dangereuse et signale un trousseau inaccessible', async () => {
    await expect(new Keychain(path).set(ITEM, 'x" -w "autre')).rejects.toThrow();
    await expect(new Keychain(join(dir, 'absent.keychain-db')).set(ITEM, 'ABCDEFGH12345678')).rejects.toThrow(
      /Trousseau/,
    );
  });
});
