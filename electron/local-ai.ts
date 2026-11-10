import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { LocalEngine } from './llama-engine';
import type {
  AiChatRequest,
  AiStreamEvent,
  AiTestResult,
  LocalDownloadEvent,
  LocalDownloadProgress,
  LocalModelsStatus,
} from './shared/ipc-contract';
import { LOCAL_MODELS, findLocalModel, type LocalModelInfo } from './shared/local-models';

const NOT_DOWNLOADED = 'Ce modèle n’est pas encore téléchargé : téléchargez-le dans les réglages.';

/**
 * Assistant avec un modèle open source (Qwen) exécuté sur l'ordinateur : aucune clé API, aucune donnée
 * envoyée sur internet. Gère aussi le téléchargement des modèles dans le dossier de l'application.
 */
export class LocalAiService {
  private readonly running = new Map<string, AbortController>();
  private current: {
    id: string;
    controller: AbortController;
    progress: LocalDownloadProgress;
  } | null = null;
  /** Une seule génération à la fois : le modèle chargé n'a qu'une séquence de contexte. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly modelsDir: string,
    private readonly engine: LocalEngine,
  ) {}

  async status(): Promise<LocalModelsStatus> {
    const models = await Promise.all(
      LOCAL_MODELS.map(async (m) => ({ id: m.id, downloaded: await this.isDownloaded(m) })),
    );
    return { models, download: this.current?.progress ?? null };
  }

  /**
   * Télécharge un modèle ; la progression et l'issue sont signalées par `emit`.
   * La promesse se termine avec le téléchargement (le process principal ne l'attend pas).
   */
  async download(id: string, emit: (event: LocalDownloadEvent) => void): Promise<void> {
    const model = requireModel(id);
    if (this.current !== null) {
      throw new Error('Un téléchargement est déjà en cours.');
    }
    // Réservé avant toute attente : deux demandes simultanées ne peuvent pas lancer deux téléchargements.
    const controller = new AbortController();
    const current = {
      id,
      controller,
      progress: { id, receivedBytes: 0, totalBytes: model.sizeBytes },
    };
    this.current = current;
    let lastPct = -1;
    try {
      if (await this.isDownloaded(model)) {
        emit({ type: 'done', id });
        return;
      }
      await mkdir(this.modelsDir, { recursive: true });
      emit({ type: 'progress', progress: current.progress });
      await this.engine.download({
        uri: model.uri,
        dirPath: this.modelsDir,
        fileName: model.fileName,
        signal: controller.signal,
        onProgress: (receivedBytes, totalBytes) => {
          current.progress = {
            id,
            receivedBytes,
            totalBytes: totalBytes > 0 ? totalBytes : model.sizeBytes,
          };
          // Un événement par pour-cent suffit à animer la barre sans saturer la page.
          const pct = Math.floor((receivedBytes / current.progress.totalBytes) * 100);
          if (pct !== lastPct) {
            lastPct = pct;
            emit({ type: 'progress', progress: current.progress });
          }
        },
      });
      if (controller.signal.aborted) {
        throw new DOMException('Annulé', 'AbortError');
      }
      if (!(await this.isDownloaded(model))) {
        await this.removeFiles(model);
        throw new Error('Le fichier téléchargé est incomplet : réessayez.');
      }
      emit({ type: 'done', id });
    } catch (error) {
      if (controller.signal.aborted) {
        await this.removeFiles(model);
        emit({ type: 'cancelled', id });
      } else {
        emit({
          type: 'error',
          id,
          message: `Téléchargement impossible : ${localErrorMessage(error)}`,
        });
      }
    } finally {
      if (this.current === current) {
        this.current = null;
      }
    }
  }

  cancelDownload(): void {
    this.current?.controller.abort();
  }

  async remove(id: string): Promise<LocalModelsStatus> {
    const model = requireModel(id);
    if (this.current?.id === id) {
      this.cancelDownload();
    }
    await this.engine.unload();
    await this.removeFiles(model);
    return this.status();
  }

  /** Charge le modèle pour vérifier qu'il fonctionne sur cet ordinateur (aucun texte généré). */
  async test(id: string): Promise<AiTestResult> {
    try {
      const model = requireModel(id);
      if (!(await this.isDownloaded(model))) {
        return { ok: false, message: NOT_DOWNLOADED };
      }
      await this.serialize(() => this.engine.load(this.pathOf(model)));
      return { ok: true, message: 'Le modèle est chargé et fonctionne sur cet ordinateur.' };
    } catch (error) {
      return { ok: false, message: localErrorMessage(error) };
    }
  }

  async chat(request: AiChatRequest, emit: (event: AiStreamEvent) => void): Promise<void> {
    const controller = new AbortController();
    const { requestId } = request;
    this.running.set(requestId, controller);
    try {
      const model = requireModel(request.model);
      if (!(await this.isDownloaded(model))) {
        throw new Error(NOT_DOWNLOADED);
      }
      const result = await this.serialize(() =>
        controller.signal.aborted
          ? Promise.resolve({ stopReason: 'aborted' as const })
          : this.engine.chat({
              modelPath: this.pathOf(model),
              system: request.system,
              messages: request.messages,
              signal: controller.signal,
              onText: (text) => emit({ requestId, type: 'delta', text }),
            }),
      );
      if (result.stopReason === 'maxTokens') {
        emit({
          requestId,
          type: 'delta',
          text: '\n\n_(Réponse interrompue : longueur maximale atteinte.)_',
        });
      }
      emit({ requestId, type: 'done' });
    } catch (error) {
      if (controller.signal.aborted) {
        emit({ requestId, type: 'done' });
      } else {
        emit({ requestId, type: 'error', message: localErrorMessage(error) });
      }
    } finally {
      this.running.delete(requestId);
    }
  }

  abort(requestId: string): void {
    this.running.get(requestId)?.abort();
  }

  /** Des ressources natives ou des tâches en cours doivent être libérées avant de quitter l'application. */
  get needsRelease(): boolean {
    return this.engine.active || this.running.size > 0 || this.current !== null;
  }

  /** Fermeture de l'application : arrêt des réponses et du téléchargement, modèle libéré. */
  async dispose(): Promise<void> {
    this.running.forEach((c) => c.abort());
    this.cancelDownload();
    await this.engine.shutdown();
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private pathOf(model: LocalModelInfo): string {
    return join(this.modelsDir, model.fileName);
  }

  private async isDownloaded(model: LocalModelInfo): Promise<boolean> {
    try {
      return (await stat(this.pathOf(model))).size === model.sizeBytes;
    } catch {
      return false;
    }
  }

  /** Supprime le fichier du modèle et les éventuels fichiers temporaires d'un téléchargement interrompu. */
  private async removeFiles(model: LocalModelInfo): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.modelsDir);
    } catch {
      return;
    }
    await Promise.all(
      names
        .filter((n) => n.startsWith(model.fileName))
        .map((n) => rm(join(this.modelsDir, n), { force: true })),
    );
  }
}

function requireModel(id: string): LocalModelInfo {
  const model = findLocalModel(id);
  if (model === undefined) {
    throw new Error('Modèle open source inconnu : choisissez-en un dans les réglages.');
  }
  return model;
}

/** Message lisible pour une erreur du moteur local ou du téléchargement. */
export function localErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /context size|too long|exceeds the context|context is full|larger than the context/i.test(
      message,
    )
  ) {
    return 'La conversation est trop longue pour le modèle local : démarrez une nouvelle conversation.';
  }
  if (
    /out of memory|not enough memory|insufficient memory|vram|failed to allocate|cannot allocate/i.test(
      message,
    )
  ) {
    return 'Mémoire insuffisante pour ce modèle : fermez d’autres applications ou choisissez un modèle plus léger.';
  }
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|network/i.test(message)) {
    return 'connexion impossible, vérifiez la connexion internet.';
  }
  if (/ENOSPC|no space left/i.test(message)) {
    return 'espace disque insuffisant.';
  }
  if (/bindings|prebuilt|binary|ERR_MODULE_NOT_FOUND|Cannot find (module|package)/i.test(message)) {
    return `Le moteur du modèle local n’a pas pu démarrer sur cet ordinateur (${message}).`;
  }
  return message;
}
