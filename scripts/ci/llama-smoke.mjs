// Vérification du moteur des modèles open source dans l'application PACKAGÉE (CI Windows ; utilisable aussi sur Mac).
//
// Lancé avec l'exécutable de l'application en mode Node :
//   ELECTRON_RUN_AS_NODE=1 <ConsoMazout> scripts/ci/llama-smoke.mjs <dossier resources> <modèle .gguf>
//
// Le moteur (`dist-electron/llama-engine.js`) est chargé depuis `app.asar` : on teste donc exactement ce qui
// est livré (binaires llama.cpp de la plateforme hors de l'asar, exclusions du packaging). Le modèle est chargé,
// puis une courte réponse est générée. Code de sortie 1 en cas d'échec.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const [resourcesArg, modelArg] = process.argv.slice(2);
if (!resourcesArg || !modelArg) {
  console.error('Usage : llama-smoke.mjs <dossier resources> <modèle .gguf>');
  process.exit(2);
}
const resources = resolve(resourcesArg);
const modelPath = resolve(modelArg);

// Fichier officiel Qwen/Qwen3-1.7B-GGUF (Qwen3-1.7B-Q8_0.gguf).
const EXPECTED_SHA256 = '061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a';
const EXPECTED_SIZE = 1_834_426_016;

function step(message) {
  console.log(`→ ${message}`);
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

try {
  step(
    `Electron ${process.versions.electron ?? '?'} · Node ${process.version} · ${process.platform}-${process.arch}`,
  );
  if (!process.versions.electron) {
    throw new Error('À lancer avec l’exécutable de l’application (ELECTRON_RUN_AS_NODE=1).');
  }
  const asar = join(resources, 'app.asar');
  const unpacked = join(resources, 'app.asar.unpacked', 'node_modules', '@node-llama-cpp');
  if (!existsSync(unpacked)) {
    throw new Error(`Binaires llama.cpp absents de l'application packagée : ${unpacked}`);
  }
  step(`binaires embarqués : ${unpacked}`);

  if (statSync(modelPath).size !== EXPECTED_SIZE || (await sha256(modelPath)) !== EXPECTED_SHA256) {
    throw new Error(`Fichier modèle inattendu : ${modelPath}`);
  }
  step('modèle Qwen3 1.7B vérifié (taille et SHA-256)');

  const require = createRequire(join(asar, 'package.json'));
  const { LlamaCppEngine } = require(join(asar, 'dist-electron', 'llama-engine.js'));
  const engine = new LlamaCppEngine();

  let t = Date.now();
  await engine.load(modelPath);
  step(`modèle chargé en ${((Date.now() - t) / 1000).toFixed(1)} s`);

  t = Date.now();
  let text = '';
  const { stopReason } = await engine.chat({
    modelPath,
    system: 'Tu es un assistant. Réponds en français, en une phrase courte.',
    messages: [{ role: 'user', content: 'Combien font 2 + 2 ?' }],
    signal: new AbortController().signal,
    onText: (chunk) => (text += chunk),
  });
  step(
    `réponse (${stopReason}) en ${((Date.now() - t) / 1000).toFixed(1)} s : ${JSON.stringify(text.trim())}`,
  );
  if (text.trim() === '') {
    throw new Error('Aucun texte généré.');
  }

  await engine.shutdown();
  step('moteur libéré : OK');
  process.exit(0);
} catch (error) {
  console.error('✗ Échec du test du moteur llama.cpp :', error);
  process.exit(1);
}
