/**
 * Preload sandboxé : seul le module `electron` est disponible à l'exécution.
 * Les autres imports doivent rester des `import type` (effacés à la compilation),
 * d'où les noms de canaux recopiés ici plutôt qu'importés.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { AiStreamEvent, ConsoMazoutApi } from './shared/ipc-contract';

const api: ConsoMazoutApi = {
  platform: process.platform,
  data: {
    load: () => ipcRenderer.invoke('data:load'),
    save: (content) => ipcRenderer.invoke('data:save', content),
    exportFile: (content, suggestedName, kind) => ipcRenderer.invoke('data:export', content, suggestedName, kind),
    importFile: () => ipcRenderer.invoke('data:import'),
    reveal: () => ipcRenderer.invoke('data:reveal'),
  },
  theme: {
    set: (mode) => ipcRenderer.invoke('theme:set', mode),
  },
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    setKey: (key) => ipcRenderer.invoke('ai:setKey', key),
    test: (model) => ipcRenderer.invoke('ai:test', model),
    chat: (request) => ipcRenderer.invoke('ai:chat', request),
    abort: (requestId) => ipcRenderer.invoke('ai:abort', requestId),
    onEvent: (listener) => {
      // L'événement Electron (et donc ipcRenderer) n'est jamais exposé à la page.
      const handler = (_event: unknown, payload: AiStreamEvent): void => listener(payload);
      ipcRenderer.on('ai:event', handler);
      return () => ipcRenderer.removeListener('ai:event', handler);
    },
  },
};

contextBridge.exposeInMainWorld('consoMazout', api);
