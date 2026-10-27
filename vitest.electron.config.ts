import { defineConfig } from 'vitest/config';

// Tests du process principal (logique pure : API Claude, stockage de la clé) : exécutés sous Node, hors Angular.
export default defineConfig({
  test: { include: ['electron/**/*.spec.ts'], environment: 'node', globals: true },
});
