import { TestBed } from '@angular/core/testing';
import type {
  AiChatRequest,
  AiStreamEvent,
  ConsoMazoutApi,
  LocalDownloadEvent,
  LocalModelsStatus,
} from '../../../../electron/shared/ipc-contract';
import { DataStore } from '../services/data-store.service';
import { AiService } from './ai.service';

/** Faux pont Electron : enregistre les requêtes envoyées et permet d'émettre des événements. */
function fakeApi(localStatus: LocalModelsStatus) {
  const sent: AiChatRequest[] = [];
  let emitChat: (event: AiStreamEvent) => void = () => undefined;
  let emitDownload: (event: LocalDownloadEvent) => void = () => undefined;
  const api = {
    platform: 'test',
    data: {
      load: async () => ({ content: null, path: '/tmp/x.json', recoveredFromBackup: false }),
      save: async () => undefined,
      exportFile: async () => null,
      importFile: async () => null,
      reveal: async () => undefined,
    },
    theme: { set: async () => undefined },
    ai: {
      status: async () => ({ hasKey: true, encryptionAvailable: true }),
      setKey: async () => ({ hasKey: true, encryptionAvailable: true }),
      test: async () => ({ ok: true, message: 'ok' }),
      chat: async (request: AiChatRequest) => {
        sent.push(request);
      },
      abort: async () => undefined,
      onEvent: (listener: (event: AiStreamEvent) => void) => {
        emitChat = listener;
        return () => undefined;
      },
      openai: {
        status: async () => ({ hasKey: true, encryptionAvailable: true }),
        setKey: vi.fn(async (key: string | null) => ({ hasKey: key !== null, encryptionAvailable: true })),
        test: vi.fn(async () => ({ ok: true, message: 'openai ok' })),
      },
      local: {
        status: async () => localStatus,
        download: vi.fn(async () => undefined),
        cancelDownload: async () => undefined,
        remove: async () => localStatus,
        test: vi.fn(async () => ({ ok: true, message: 'chargé' })),
        onDownload: (listener: (event: LocalDownloadEvent) => void) => {
          emitDownload = listener;
          return () => undefined;
        },
      },
    },
  } satisfies ConsoMazoutApi;
  return { api, sent, chat: (e: AiStreamEvent) => emitChat(e), download: (e: LocalDownloadEvent) => emitDownload(e) };
}

describe('AiService (page)', () => {
  const notDownloaded: LocalModelsStatus = {
    models: [
      { id: 'qwen3-1.7b', downloaded: false },
      { id: 'qwen3-4b', downloaded: false },
      { id: 'qwen3-8b', downloaded: false },
    ],
    download: null,
  };
  let fake: ReturnType<typeof fakeApi>;

  function setup(status: LocalModelsStatus = notDownloaded): { ai: AiService; store: DataStore } {
    fake = fakeApi(status);
    window.consoMazout = fake.api;
    TestBed.configureTestingModule({});
    return { ai: TestBed.inject(AiService), store: TestBed.inject(DataStore) };
  }

  afterEach(() => {
    delete window.consoMazout;
    TestBed.resetTestingModule();
  });

  it('par défaut : Claude, requête inchangée (sans fournisseur)', async () => {
    const { ai, store } = setup();
    await ai.refreshStatus();
    expect(ai.provider()).toBe('claude');
    expect(ai.ready()).toBe(true);
    await ai.send('Quand commander ?');
    expect(fake.sent).toHaveLength(1);
    const request = fake.sent[0]!;
    expect(Object.keys(request).sort()).toEqual(['messages', 'model', 'requestId', 'system']);
    expect(request.model).toBe(store.settings().aiModel);
    expect(request.messages).toEqual([{ role: 'user', content: 'Quand commander ?' }]);
    expect(request.system).toContain('<donnees>');
  });

  it('modèle local : prêt seulement une fois téléchargé', async () => {
    const { ai, store } = setup();
    store.updateSettings({ aiProvider: 'local', localModel: 'qwen3-1.7b' });
    await ai.refreshLocalStatus();
    expect(ai.ready()).toBe(false);

    fake.api.ai.local.status = async () => ({
      models: notDownloaded.models.map((m) => (m.id === 'qwen3-1.7b' ? { ...m, downloaded: true } : m)),
      download: null,
    });
    fake.download({ type: 'done', id: 'qwen3-1.7b' });
    await vi.waitFor(() => expect(ai.ready()).toBe(true));
    expect(ai.downloadProgress()).toBeNull();
  });

  it('modèle local : requête marquée « local » avec le modèle choisi et un contexte compact', async () => {
    const { ai, store } = setup();
    store.loadDemo();
    await ai.send('Question Claude');
    const claudeSystem = fake.sent[0]!.system;
    ai.newConversation();

    store.updateSettings({ aiProvider: 'local', localModel: 'qwen3-8b' });
    await ai.send('Question locale');
    const request = fake.sent[1]!;
    expect(request.provider).toBe('local');
    expect(request.model).toBe('qwen3-8b');
    expect(request.system.length).toBeLessThanOrEqual(claudeSystem.length);
  });

  it('OpenAI : requête marquée « openai », modèle choisi, contexte complet comme Claude', async () => {
    const { ai, store } = setup();
    store.loadDemo();
    await ai.send('Question Claude');
    const claudeRequest = fake.sent[0]!;
    ai.newConversation();

    store.updateSettings({ aiProvider: 'openai', openaiModel: 'gpt-5.4-mini' });
    await ai.refreshOpenAiStatus();
    expect(ai.ready()).toBe(true);
    await ai.send('Question Claude');
    const request = fake.sent[1]!;
    expect(request.provider).toBe('openai');
    expect(request.model).toBe('gpt-5.4-mini');
    expect(request.system).toBe(claudeRequest.system);
    expect(request.messages).toEqual(claudeRequest.messages);
  });

  it('OpenAI : clé et test passent par le pont OpenAI, pas par celui de Claude', async () => {
    const { ai, store } = setup();
    store.updateSettings({ aiProvider: 'openai', openaiModel: 'gpt-6-luna' });
    await ai.setOpenAiKey('  sk-proj-test  ');
    expect(fake.api.ai.openai.setKey).toHaveBeenCalledWith('sk-proj-test');
    expect(await ai.testOpenAi()).toEqual({ ok: true, message: 'openai ok' });
    expect(fake.api.ai.openai.test).toHaveBeenCalledWith('gpt-6-luna');
    await ai.clearOpenAiKey();
    expect(ai.openaiStatus().hasKey).toBe(false);
    expect(ai.ready()).toBe(false);
  });

  it('progression du téléchargement suivie', () => {
    const { ai } = setup();
    fake.download({ type: 'progress', progress: { id: 'qwen3-4b', receivedBytes: 10, totalBytes: 100 } });
    expect(ai.downloadProgress()).toEqual({ id: 'qwen3-4b', receivedBytes: 10, totalBytes: 100 });
    fake.download({ type: 'cancelled', id: 'qwen3-4b' });
    expect(ai.downloadProgress()).toBeNull();
  });

  it('flux de réponse identique quel que soit le moteur', async () => {
    const { ai, store } = setup();
    store.updateSettings({ aiProvider: 'local' });
    await ai.send('Bonjour');
    const requestId = fake.sent[0]!.requestId;
    fake.chat({ requestId, type: 'delta', text: 'Salut' });
    fake.chat({ requestId, type: 'done' });
    expect(ai.busy()).toBe(false);
    expect(ai.messages().at(-1)).toMatchObject({ role: 'assistant', content: 'Salut' });
  });

  it('test du modèle local : modèle choisi', async () => {
    const { ai, store } = setup();
    store.updateSettings({ aiProvider: 'local', localModel: 'qwen3-4b' });
    expect(await ai.testLocal()).toEqual({ ok: true, message: 'chargé' });
    expect(fake.api.ai.local.test).toHaveBeenCalledWith('qwen3-4b');
  });
});
