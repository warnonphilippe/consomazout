import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODELS_DIR_ENV, resolveModelsDir, sharedModelsConfigFile } from './models-dir';

const home = '/Users/test';
const fallback = '/Users/test/Library/Application Support/App/models';
const noFile = () => { throw new Error('ENOENT'); };

describe('resolveModelsDir', () => {
  it('garde le dossier propre à l’application sans configuration (rétro-compatibilité)', () => {
    expect(resolveModelsDir(fallback, { env: {}, home, readFile: noFile })).toBe(fallback);
  });

  it('utilise la variable LOCAL_MODELS_DIR en priorité', () => {
    const readFile = () => JSON.stringify({ modelsDir: '/autre' });
    expect(resolveModelsDir(fallback, { env: { [MODELS_DIR_ENV]: '/srv/models' }, home, readFile })).toBe('/srv/models');
  });

  it('lit modelsDir dans ~/.config/local-models/config.json et développe ~', () => {
    let asked = '';
    const readFile = (p: string) => { asked = p; return JSON.stringify({ modelsDir: '~/models' }); };
    expect(resolveModelsDir(fallback, { env: {}, home, readFile })).toBe(join(home, 'models'));
    expect(asked).toBe(sharedModelsConfigFile(home));
  });

  it('ignore les valeurs vides, relatives ou un fichier invalide', () => {
    expect(resolveModelsDir(fallback, { env: { [MODELS_DIR_ENV]: '  ' }, home, readFile: noFile })).toBe(fallback);
    expect(resolveModelsDir(fallback, { env: { [MODELS_DIR_ENV]: 'models' }, home, readFile: () => '{"modelsDir":"rel"}' })).toBe(fallback);
    expect(resolveModelsDir(fallback, { env: {}, home, readFile: () => 'pas du json' })).toBe(fallback);
    expect(resolveModelsDir(fallback, { env: {}, home, readFile: () => '{"modelsDir":42}' })).toBe(fallback);
  });
});
