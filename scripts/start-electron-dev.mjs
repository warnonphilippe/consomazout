// Lance Electron sur le serveur de développement Angular (multiplateforme, sans syntaxe shell).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');

const child = spawn(electronBinary, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, CONSOMAZOUT_DEV_URL: process.env.CONSOMAZOUT_DEV_URL ?? 'http://localhost:4200' },
});
child.on('exit', (code) => process.exit(code ?? 0));
