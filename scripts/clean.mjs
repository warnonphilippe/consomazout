// Supprime les dossiers passés en argument (équivalent multiplateforme de `rm -rf`).
import { rmSync } from 'node:fs';

for (const target of process.argv.slice(2)) {
  rmSync(target, { recursive: true, force: true });
}
