import { mkdtemp, readdir, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DownloadOptions,
  LocalChatOptions,
  LocalChatResult,
  LocalEngine,
} from './llama-engine';
import { LocalAiService, localErrorMessage } from './local-ai';
import type { AiChatRequest, AiStreamEvent, LocalDownloadEvent } from './shared/ipc-contract';
import { LOCAL_MODELS, findLocalModel } from './shared/local-models';

const MODEL = findLocalModel('qwen3-1.7b')!;

const request: AiChatRequest = {
  requestId: 'r1',
  provider: 'local',
  model: MODEL.id,
  system: 'Contexte : données de la cuve',
  messages: [{ role: 'user', content: 'Quand commander ?' }],
};

/** Crée un fichier de la taille exacte du modèle (fichier creux : aucun octet réellement écrit). */
async function fakeModelFile(dir: string, model = MODEL): Promise<void> {
  const path = join(dir, model.fileName);
  await writeFile(path, '');
  await truncate(path, model.sizeBytes);
}

class FakeEngine implements LocalEngine {
  get active(): boolean {
    return this.loaded !== null;
  }
  chunks = ['Bonjour', ' Philippe'];
  result: LocalChatResult = { stopReason: 'end' };
  failWith: unknown = null;
  lastChat: LocalChatOptions | null = null;
  loaded: string | null = null;
  unloads = 0;
  /** Pilotage du faux téléchargement. */
  downloadBehavior: (options: DownloadOptions) => Promise<void> = async () => undefined;

  download(options: DownloadOptions): Promise<void> {
    return this.downloadBehavior(options);
  }

  async load(modelPath: string): Promise<void> {
    if (this.failWith) {
      throw this.failWith;
    }
    this.loaded = modelPath;
  }

  async chat(options: LocalChatOptions): Promise<LocalChatResult> {
    this.lastChat = options;
    for (const chunk of this.chunks) {
      await Promise.resolve();
      if (options.signal.aborted) {
        return { stopReason: 'aborted' };
      }
      options.onText(chunk);
    }
    if (this.failWith) {
      throw this.failWith;
    }
    return this.result;
  }

  async unload(): Promise<void> {
    this.unloads++;
    this.loaded = null;
  }

  shutdowns = 0;
  async shutdown(): Promise<void> {
    await this.unload();
    this.shutdowns++;
  }
}

describe('LocalAiService', () => {
  let dir: string;
  let engine: FakeEngine;
  let service: LocalAiService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'consomazout-models-'));
    engine = new FakeEngine();
    service = new LocalAiService(dir, engine);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function chat(req: AiChatRequest = request): Promise<AiStreamEvent[]> {
    const events: AiStreamEvent[] = [];
    await service.chat(req, (e) => events.push(e));
    return events;
  }

  describe('conversation', () => {
    it('relaie le texte en flux puis signale la fin', async () => {
      await fakeModelFile(dir);
      expect(await chat()).toEqual([
        { requestId: 'r1', type: 'delta', text: 'Bonjour' },
        { requestId: 'r1', type: 'delta', text: ' Philippe' },
        { requestId: 'r1', type: 'done' },
      ]);
      expect(engine.lastChat).toMatchObject({
        modelPath: join(dir, MODEL.fileName),
        system: request.system,
        messages: request.messages,
      });
    });

    it('modèle non téléchargé : erreur explicite, moteur non sollicité', async () => {
      expect((await chat()).at(-1)).toMatchObject({
        type: 'error',
        message: expect.stringContaining('téléchargé'),
      });
      expect(engine.lastChat).toBeNull();
    });

    it('fichier incomplet : considéré comme non téléchargé', async () => {
      await writeFile(join(dir, MODEL.fileName), 'début du fichier');
      expect((await chat()).at(-1)).toMatchObject({ type: 'error' });
    });

    it('modèle inconnu : erreur', async () => {
      expect((await chat({ ...request, model: 'llama-inconnu' })).at(-1)).toMatchObject({
        type: 'error',
        message: expect.stringContaining('inconnu'),
      });
    });

    it('réponse coupée : mention ajoutée', async () => {
      await fakeModelFile(dir);
      engine.result = { stopReason: 'maxTokens' };
      const events = await chat();
      expect(events.at(-2)).toMatchObject({
        type: 'delta',
        text: expect.stringContaining('longueur maximale'),
      });
      expect(events.at(-1)).toEqual({ requestId: 'r1', type: 'done' });
    });

    it('arrêt demandé : fin du flux sans erreur', async () => {
      await fakeModelFile(dir);
      const events: AiStreamEvent[] = [];
      const done = service.chat(request, (e) => {
        events.push(e);
        service.abort('r1');
      });
      await done;
      expect(events.at(-1)).toEqual({ requestId: 'r1', type: 'done' });
      expect(events.filter((e) => e.type === 'delta')).toHaveLength(1);
    });

    it('erreur du moteur traduite', async () => {
      await fakeModelFile(dir);
      engine.failWith = new Error('The context size is too small to fit the prompt');
      expect((await chat()).at(-1)).toMatchObject({
        type: 'error',
        message: expect.stringContaining('trop longue'),
      });
    });

    it('une seule génération à la fois', async () => {
      await fakeModelFile(dir);
      let active = 0;
      let max = 0;
      const chatImpl = engine.chat.bind(engine);
      engine.chat = async (options) => {
        active++;
        max = Math.max(max, active);
        try {
          return await chatImpl(options);
        } finally {
          active--;
        }
      };
      await Promise.all([chat(), chat({ ...request, requestId: 'r2' })]);
      expect(max).toBe(1);
    });
  });

  describe('modèles', () => {
    it('état : aucun modèle au départ, puis téléchargé', async () => {
      expect(await service.status()).toEqual({
        models: LOCAL_MODELS.map((m) => ({ id: m.id, downloaded: false })),
        download: null,
      });
      await fakeModelFile(dir);
      expect((await service.status()).models.find((m) => m.id === MODEL.id)?.downloaded).toBe(true);
    });

    it('téléchargement : progression puis fin', async () => {
      engine.downloadBehavior = async (options) => {
        expect(options).toMatchObject({ uri: MODEL.uri, dirPath: dir, fileName: MODEL.fileName });
        options.onProgress(MODEL.sizeBytes / 2, MODEL.sizeBytes);
        options.onProgress(MODEL.sizeBytes / 2 + 1, MODEL.sizeBytes); // même pour-cent : pas d'événement
        await fakeModelFile(dir);
        options.onProgress(MODEL.sizeBytes, MODEL.sizeBytes);
      };
      const events: LocalDownloadEvent[] = [];
      await service.download(MODEL.id, (e) => events.push(e));
      expect(
        events.map((e) => (e.type === 'progress' ? e.progress.receivedBytes : e.type)),
      ).toEqual([0, MODEL.sizeBytes / 2, MODEL.sizeBytes, 'done']);
      expect((await service.status()).download).toBeNull();
    });

    it('un seul téléchargement à la fois, progression visible dans l’état', async () => {
      let release!: () => void;
      engine.downloadBehavior = (options) =>
        new Promise<void>((resolve) => {
          options.onProgress(1000, MODEL.sizeBytes);
          release = resolve;
        });
      const first = service.download(MODEL.id, () => undefined);
      await vi.waitFor(() => expect(release).toBeDefined());
      expect((await service.status()).download).toEqual({
        id: MODEL.id,
        receivedBytes: 1000,
        totalBytes: MODEL.sizeBytes,
      });
      await expect(service.download('qwen3-4b', () => undefined)).rejects.toThrow('déjà en cours');
      await fakeModelFile(dir);
      release();
      await first;
    });

    it('deux demandes simultanées : la seconde est refusée', async () => {
      engine.downloadBehavior = () => fakeModelFile(dir);
      const first = service.download(MODEL.id, () => undefined);
      await expect(service.download(MODEL.id, () => undefined)).rejects.toThrow('déjà en cours');
      await first;
    });

    it('annulation : fichiers temporaires effacés, événement « cancelled »', async () => {
      engine.downloadBehavior = (options) =>
        new Promise<void>((_resolve, reject) => {
          void writeFile(join(dir, `${MODEL.fileName}.ipull`), 'partiel');
          options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      const events: LocalDownloadEvent[] = [];
      const done = service.download(MODEL.id, (e) => events.push(e));
      await vi.waitFor(async () => expect(await readdir(dir)).toContain(`${MODEL.fileName}.ipull`));
      service.cancelDownload();
      await done;
      expect(events.at(-1)).toEqual({ type: 'cancelled', id: MODEL.id });
      expect(await readdir(dir)).toEqual([]);
    });

    it('échec : message d’erreur, fichier incomplet supprimé', async () => {
      engine.downloadBehavior = async () => {
        await writeFile(join(dir, MODEL.fileName), 'tronqué');
      };
      const events: LocalDownloadEvent[] = [];
      await service.download(MODEL.id, (e) => events.push(e));
      expect(events.at(-1)).toMatchObject({
        type: 'error',
        message: expect.stringContaining('incomplet'),
      });
      expect(await readdir(dir)).toEqual([]);

      engine.downloadBehavior = async () => {
        throw new Error('getaddrinfo ENOTFOUND huggingface.co');
      };
      await service.download(MODEL.id, (e) => events.push(e));
      expect(events.at(-1)).toMatchObject({
        type: 'error',
        message: expect.stringContaining('connexion internet'),
      });
    });

    it('déjà téléchargé : terminé sans rien retélécharger', async () => {
      await fakeModelFile(dir);
      const behavior = vi.fn();
      engine.downloadBehavior = behavior;
      const events: LocalDownloadEvent[] = [];
      await service.download(MODEL.id, (e) => events.push(e));
      expect(events).toEqual([{ type: 'done', id: MODEL.id }]);
      expect(behavior).not.toHaveBeenCalled();
    });

    it('suppression : modèle déchargé puis effacé', async () => {
      await fakeModelFile(dir);
      const status = await service.remove(MODEL.id);
      expect(engine.unloads).toBe(1);
      expect(status.models.find((m) => m.id === MODEL.id)?.downloaded).toBe(false);
      expect(await readdir(dir)).toEqual([]);
    });

    it('test : charge le modèle, ou explique pourquoi c’est impossible', async () => {
      expect(await service.test(MODEL.id)).toMatchObject({
        ok: false,
        message: expect.stringContaining('téléchargé'),
      });
      await fakeModelFile(dir);
      expect(await service.test(MODEL.id)).toMatchObject({ ok: true });
      expect(engine.loaded).toBe(join(dir, MODEL.fileName));
      engine.failWith = new Error('ggml: failed to allocate buffer');
      expect(await service.test(MODEL.id)).toMatchObject({
        ok: false,
        message: expect.stringContaining('Mémoire'),
      });
    });

    it('libération nécessaire seulement si le moteur a servi', async () => {
      expect(service.needsRelease).toBe(false);
      await fakeModelFile(dir);
      await service.test(MODEL.id);
      expect(service.needsRelease).toBe(true);
      await service.dispose();
      expect(service.needsRelease).toBe(false);
    });

    it('fermeture : réponse en cours arrêtée, modèle et moteur libérés', async () => {
      await fakeModelFile(dir);
      const events: AiStreamEvent[] = [];
      const running = service.chat(request, (e) => events.push(e));
      await service.dispose();
      await running;
      expect(engine.shutdowns).toBe(1);
      expect(events.at(-1)).toMatchObject({ type: 'done' });
    });
  });
});

describe('catalogue des modèles locaux', () => {
  it('identifiants uniques, fichiers GGUF officiels Qwen', () => {
    expect(new Set(LOCAL_MODELS.map((m) => m.id)).size).toBe(LOCAL_MODELS.length);
    for (const m of LOCAL_MODELS) {
      expect(m.uri).toBe(`hf:Qwen/${m.uri.split('/')[1]}/${m.fileName}`);
      expect(m.fileName).toMatch(/\.gguf$/);
      expect(m.sizeBytes).toBeGreaterThan(1e9);
    }
  });
});

describe('localErrorMessage', () => {
  it('erreurs fréquentes traduites', () => {
    expect(localErrorMessage(new Error('out of memory'))).toContain('Mémoire');
    expect(localErrorMessage(new Error('ENOSPC: no space left on device'))).toContain(
      'espace disque',
    );
    expect(localErrorMessage(new Error('autre'))).toBe('autre');
  });
});
