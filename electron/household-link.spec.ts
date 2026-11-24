import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HouseholdLink, LINK_DIR_ENV, isLinkedApp, resolveLinkDir, summaryPath } from './household-link';

const home = '/Users/test';

describe('resolveLinkDir', () => {
  it('utilise ~/.config/conso-maison par défaut, et un dossier séparé en développement', () => {
    expect(resolveLinkDir({ env: {}, home })).toBe(join(home, '.config', 'conso-maison'));
    expect(resolveLinkDir({ env: {}, home, dev: true })).toBe(join(home, '.config', 'conso-maison-dev'));
  });

  it('donne la priorité à CONSO_MAISON_DIR (absolu, ~ accepté) et ignore une valeur relative', () => {
    expect(resolveLinkDir({ env: { [LINK_DIR_ENV]: '~/partage' }, home, dev: true })).toBe(join(home, 'partage'));
    expect(resolveLinkDir({ env: { [LINK_DIR_ENV]: '/srv/maison' }, home })).toBe('/srv/maison');
    expect(resolveLinkDir({ env: { [LINK_DIR_ENV]: 'relatif' }, home })).toBe(join(home, '.config', 'conso-maison'));
  });
});

describe('HouseholdLink', () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(await mkdtemp(join(tmpdir(), 'conso-maison-')), 'lien');
  });

  afterEach(async () => {
    await rm(join(dir, '..'), { recursive: true, force: true });
  });

  it('publie son résumé (droits 0600) et le relit depuis l’autre application', async () => {
    await new HouseholdLink(dir, 'consoelec').publish('{"schema":1,"a":2}');
    expect(JSON.parse(await readFile(summaryPath(dir, 'consoelec'), 'utf-8'))).toEqual({ schema: 1, a: 2 });
    expect((await stat(summaryPath(dir, 'consoelec'))).mode & 0o777).toBe(0o600);
    expect(await new HouseholdLink(dir, 'consomazout').read('consoelec')).toEqual({ schema: 1, a: 2 });
  });

  it('refuse un contenu qui n’est pas un objet JSON', async () => {
    const link = new HouseholdLink(dir, 'consoelec');
    await expect(link.publish('pas du json')).rejects.toThrow();
    await expect(link.publish('[1,2]')).rejects.toThrow('Résumé invalide.');
  });

  it('renvoie null sans résumé ou pour un fichier invalide', async () => {
    const link = new HouseholdLink(dir, 'consomazout');
    expect(await link.read('consoelec')).toBeNull();
    await new HouseholdLink(dir, 'consoelec').publish('{}');
    await writeFile(summaryPath(dir, 'consoelec'), '{ cassé');
    expect(await link.read('consoelec')).toBeNull();
  });

  it('reconnaît les applications liées', () => {
    expect(isLinkedApp('consomazout')).toBe(true);
    expect(isLinkedApp('autre')).toBe(false);
  });
});
