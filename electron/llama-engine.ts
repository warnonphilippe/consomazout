import type * as NodeLlamaCpp from 'node-llama-cpp' with { 'resolution-mode': 'import' };
import type { AiMessage } from './shared/ipc-contract';

/** Réponse maximale d'un tour (le reste du contexte sert aux données et à l'historique). */
const MAX_RESPONSE_TOKENS = 2048;
/** Le contexte s'adapte à la mémoire disponible, entre ces deux bornes (en jetons). */
// Sous Linux, l'allocateur de Chromium (qui remplace malloc dans tout le process Electron) refuse les blocs
// de plus de ~1 Go : le cache du contexte est alors limité. Mac (Metal) et Windows ne sont pas concernés.
const CONTEXT_SIZE = { min: 8192, max: process.platform === 'linux' ? 8192 : 16384 };

export interface DownloadOptions {
  readonly uri: string;
  readonly dirPath: string;
  readonly fileName: string;
  readonly signal: AbortSignal;
  onProgress(receivedBytes: number, totalBytes: number): void;
}

export interface LocalChatOptions {
  readonly modelPath: string;
  readonly system: string;
  /** Historique complet ; le dernier message est la question de l'utilisateur. */
  readonly messages: readonly AiMessage[];
  readonly signal: AbortSignal;
  onText(text: string): void;
}

export interface LocalChatResult {
  /** `maxTokens` : réponse coupée à la longueur maximale. */
  readonly stopReason: 'end' | 'maxTokens' | 'aborted';
}

/** Moteur d'inférence local : remplaçable par un faux dans les tests. */
export interface LocalEngine {
  /** Le moteur natif a été démarré (il faut le libérer avant de quitter). */
  readonly active: boolean;
  download(options: DownloadOptions): Promise<void>;
  /** Charge le modèle (ou réutilise celui déjà chargé). */
  load(modelPath: string): Promise<void>;
  chat(options: LocalChatOptions): Promise<LocalChatResult>;
  /** Libère le modèle chargé (mémoire vive / vidéo). */
  unload(): Promise<void>;
  /** Fermeture de l'application : modèle et moteur libérés. */
  shutdown(): Promise<void>;
}

type Module = typeof NodeLlamaCpp;

/**
 * Moteur llama.cpp embarqué (node-llama-cpp, binaires précompilés : Metal sur Mac, CPU/Vulkan sur Windows).
 * Le paquet est un module ES : il est chargé à la première utilisation, jamais au démarrage de l'application.
 */
export class LlamaCppEngine implements LocalEngine {
  private module: Promise<Module> | null = null;
  private llama: Promise<NodeLlamaCpp.Llama> | null = null;
  /**
   * Modèle chargé, avec une séquence de contexte gardée d'une question à l'autre : le début commun du prompt
   * (consignes, données, historique) n'est pas réévalué, seule la nouvelle question l'est.
   */
  private loaded: {
    path: string;
    model: NodeLlamaCpp.LlamaModel;
    context: NodeLlamaCpp.LlamaContext;
    sequence: NodeLlamaCpp.LlamaContextSequence;
  } | null = null;
  private loading: Promise<NonNullable<LlamaCppEngine['loaded']>> | null = null;

  get active(): boolean {
    return this.llama !== null || this.loaded !== null || this.loading !== null;
  }

  async download(options: DownloadOptions): Promise<void> {
    const { createModelDownloader } = await this.lib();
    const downloader = await createModelDownloader({
      modelUri: options.uri,
      dirPath: options.dirPath,
      fileName: options.fileName,
      showCliProgress: false,
      deleteTempFileOnCancel: true,
      onProgress: ({ downloadedSize, totalSize }) => options.onProgress(downloadedSize, totalSize),
    });
    await downloader.download({ signal: options.signal });
  }

  async load(modelPath: string): Promise<void> {
    await this.ensureLoaded(modelPath);
  }

  async chat(options: LocalChatOptions): Promise<LocalChatResult> {
    const { LlamaChatSession, QwenChatWrapper } = await this.lib();
    const { sequence } = await this.ensureLoaded(options.modelPath);
    const history = options.messages.slice(0, -1);
    const question = options.messages.at(-1);
    if (question === undefined || question.role !== 'user') {
      throw new Error('La conversation doit se terminer par une question.');
    }
    const session = new LlamaChatSession({
      contextSequence: sequence,
      autoDisposeSequence: false,
      // Qwen3 : pas de « réflexion » préalable, la réponse commence tout de suite.
      chatWrapper: new QwenChatWrapper({ thoughts: 'discourage' }),
    });
    try {
      session.setChatHistory([
        { type: 'system', text: options.system },
        ...history.map((m) =>
          m.role === 'user'
            ? { type: 'user' as const, text: m.content }
            : { type: 'model' as const, response: [m.content] },
        ),
      ]);
      const { stopReason } = await session.promptWithMeta(question.content, {
        signal: options.signal,
        stopOnAbortSignal: true,
        maxTokens: MAX_RESPONSE_TOKENS,
        temperature: 0.6,
        topP: 0.95,
        topK: 20,
        budgets: { thoughtTokens: 0 },
        // Seul le texte principal est relayé (les éventuels segments de réflexion sont ignorés).
        onResponseChunk: (chunk) => {
          if (chunk.type === undefined && chunk.text !== '') {
            options.onText(chunk.text);
          }
        },
      });
      return {
        stopReason:
          stopReason === 'abort' ? 'aborted' : stopReason === 'maxTokens' ? 'maxTokens' : 'end',
      };
    } finally {
      session.dispose({ disposeSequence: false });
    }
  }

  async unload(): Promise<void> {
    const loading = this.loading;
    this.loading = null;
    const loaded = this.loaded ?? (await loading?.catch(() => null)) ?? null;
    this.loaded = null;
    if (loaded) {
      await loaded.context.dispose();
      await loaded.model.dispose();
    }
  }

  async shutdown(): Promise<void> {
    await this.unload();
    const llama = await this.llama?.catch(() => null);
    this.llama = null;
    await llama?.dispose();
  }

  private lib(): Promise<Module> {
    // `import()` reste un vrai import dynamique dans la sortie CommonJS (module « nodenext »).
    this.module ??= import('node-llama-cpp');
    return this.module;
  }

  private getLlama(): Promise<NodeLlamaCpp.Llama> {
    this.llama ??= this.lib().then(({ getLlama, LlamaLogLevel }) =>
      // Binaires précompilés uniquement : jamais de compilation de llama.cpp sur l'ordinateur de l'utilisateur.
      getLlama({ gpu: 'auto', build: 'never', progressLogs: false, logLevel: LlamaLogLevel.error }),
    );
    this.llama.catch(() => (this.llama = null));
    return this.llama;
  }

  private async ensureLoaded(modelPath: string): Promise<NonNullable<LlamaCppEngine['loaded']>> {
    if (this.loaded?.path === modelPath) {
      return this.loaded;
    }
    if (this.loading) {
      const pending = await this.loading.catch(() => null);
      if (pending?.path === modelPath) {
        return pending;
      }
    }
    await this.unload();
    const loading = (async () => {
      const llama = await this.getLlama();
      const model = await llama.loadModel({ modelPath });
      try {
        const context = await model.createContext({ contextSize: CONTEXT_SIZE, sequences: 1 });
        return { path: modelPath, model, context, sequence: context.getSequence() };
      } catch (error) {
        await model.dispose();
        throw error;
      }
    })();
    this.loading = loading;
    try {
      this.loaded = await loading;
      return this.loaded;
    } finally {
      if (this.loading === loading) {
        this.loading = null;
      }
    }
  }
}
