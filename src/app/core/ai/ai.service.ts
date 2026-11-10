import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type {
  AiChatRequest,
  AiStatus,
  AiStreamEvent,
  AiTestResult,
  LocalDownloadEvent,
  LocalDownloadProgress,
  LocalModelsStatus,
} from '../../../../electron/shared/ipc-contract';
import { LOCAL_MODELS, type AiProvider, type AppData } from '../models/app-data.model';
import { newId } from '../models/normalize';
import { DataStore } from '../services/data-store.service';
import { ToastService } from '../services/toast.service';
import { COMPACT_LIMITS, buildSystemPrompt } from './ai-context';

export interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly error?: boolean;
}

/**
 * Assistant IA : état de la conversation, clé API Claude (jamais lue par la page) et modèles open source
 * locaux (Qwen), utilisables sans clé.
 */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly store = inject(DataStore);
  private readonly toast = inject(ToastService);
  private readonly api = typeof window !== 'undefined' ? (window.consoMazout?.ai ?? null) : null;

  /** Les appels à Claude passent par l'application de bureau ; indisponibles dans un simple navigateur. */
  readonly available = this.api !== null;
  readonly status = signal<AiStatus>({ hasKey: false, encryptionAvailable: false });
  /** Clé API OpenAI (jamais lue par la page). */
  readonly openaiStatus = signal<AiStatus>({ hasKey: false, encryptionAvailable: false });

  /** Moteur choisi dans les réglages : Claude (par défaut, recommandé) ou modèle open source local. */
  readonly provider = computed<AiProvider>(() => this.store.settings().aiProvider);
  readonly localModel = computed(
    () => LOCAL_MODELS.find((m) => m.id === this.store.settings().localModel) ?? LOCAL_MODELS[0]!,
  );
  readonly localStatus = signal<LocalModelsStatus>({ models: [], download: null });
  readonly downloadProgress = signal<LocalDownloadProgress | null>(null);
  /** Le modèle local choisi est présent sur l'ordinateur. */
  readonly localReady = computed(() =>
    this.localStatus().models.some((m) => m.id === this.localModel().id && m.downloaded),
  );
  /** L'assistant peut répondre : clé enregistrée (Claude, OpenAI) ou modèle téléchargé (local). */
  readonly ready = computed(() => {
    const provider = this.provider();
    if (provider === 'local') {
      return this.localReady();
    }
    return provider === 'openai' ? this.openaiStatus().hasKey : this.status().hasKey;
  });

  readonly open = signal(false);
  readonly messages = signal<ChatMessage[]>([]);
  readonly busy = signal(false);
  private currentRequest: string | null = null;

  /**
   * Contexte figé pour la conversation en cours : identique d'un tour à l'autre, il reste en cache
   * côté Claude. Il est reconstruit seulement si les données changent.
   */
  private context: { data: AppData; provider: AiProvider; system: string } | null = null;

  constructor() {
    if (this.api !== null) {
      const off = this.api.onEvent((event) => this.onEvent(event));
      const destroyRef = inject(DestroyRef);
      destroyRef.onDestroy(off);
      void this.refreshStatus();
      if (this.api.openai) {
        void this.refreshOpenAiStatus();
      }
      // Modèles locaux : absents des versions plus anciennes du process principal.
      if (this.api.local) {
        const offDownload = this.api.local.onDownload((event) => this.onDownload(event));
        destroyRef.onDestroy(offDownload);
        void this.refreshLocalStatus();
      }
    }
  }

  hasKey(): boolean {
    return this.status().hasKey;
  }

  async refreshStatus(): Promise<void> {
    if (this.api) {
      this.status.set(await this.api.status());
    }
  }

  async setKey(key: string): Promise<void> {
    this.status.set(await this.require().setKey(key.trim()));
  }

  async clearKey(): Promise<void> {
    this.status.set(await this.require().setKey(null));
  }

  test(): Promise<AiTestResult> {
    return this.require().test(this.store.settings().aiModel);
  }

  async refreshOpenAiStatus(): Promise<void> {
    if (this.api?.openai) {
      this.openaiStatus.set(await this.api.openai.status());
    }
  }

  async setOpenAiKey(key: string): Promise<void> {
    this.openaiStatus.set(await this.requireOpenAi().setKey(key.trim()));
  }

  async clearOpenAiKey(): Promise<void> {
    this.openaiStatus.set(await this.requireOpenAi().setKey(null));
  }

  testOpenAi(): Promise<AiTestResult> {
    return this.requireOpenAi().test(this.store.settings().openaiModel);
  }

  /** Vérifie que le modèle local choisi se charge sur cet ordinateur. */
  testLocal(): Promise<AiTestResult> {
    return this.requireLocal().test(this.localModel().id);
  }

  async refreshLocalStatus(): Promise<void> {
    if (this.api?.local) {
      const status = await this.api.local.status();
      this.localStatus.set(status);
      this.downloadProgress.set(status.download);
    }
  }

  async downloadModel(id: string): Promise<void> {
    await this.requireLocal().download(id);
  }

  async cancelDownload(): Promise<void> {
    await this.requireLocal().cancelDownload();
  }

  async removeModel(id: string): Promise<void> {
    this.localStatus.set(await this.requireLocal().remove(id));
  }

  async send(text: string): Promise<void> {
    const api = this.require();
    const content = text.trim();
    if (content === '' || this.busy()) {
      return;
    }
    const requestId = newId();
    this.currentRequest = requestId;
    this.messages.update((list) => [
      ...list,
      { id: newId(), role: 'user', content },
      { id: requestId, role: 'assistant', content: '' },
    ]);
    this.busy.set(true);
    const history = this.messages()
      .filter((m) => !m.error && m.id !== requestId && m.content !== '')
      .map((m) => ({ role: m.role, content: m.content }));
    const provider = this.provider();
    const system = this.systemPrompt(provider);
    const request: AiChatRequest =
      provider === 'local'
        ? { requestId, provider, model: this.localModel().id, system, messages: history }
        : provider === 'openai'
          ? { requestId, provider, model: this.store.settings().openaiModel, system, messages: history }
          : // Claude : requête inchangée.
            { requestId, model: this.store.settings().aiModel, system, messages: history };
    try {
      await api.chat(request);
    } catch (error) {
      this.fail(requestId, error instanceof Error ? error.message : String(error));
    }
  }

  stop(): void {
    if (this.currentRequest !== null) {
      void this.api?.abort(this.currentRequest);
    }
  }

  newConversation(): void {
    this.stop();
    this.messages.set([]);
    this.busy.set(false);
    this.context = null;
  }

  private systemPrompt(provider: AiProvider): string {
    const data = this.store.data();
    if (this.context === null || this.context.data !== data || this.context.provider !== provider) {
      const analysis = this.store.analysis();
      const now = this.store.now();
      // Modèle local : contexte plus court, limité aux relevés et pleins les plus récents.
      const system =
        provider === 'local'
          ? buildSystemPrompt(data, analysis, now, COMPACT_LIMITS)
          : buildSystemPrompt(data, analysis, now);
      this.context = { data, provider, system };
    }
    return this.context.system;
  }

  private onDownload(event: LocalDownloadEvent): void {
    if (event.type === 'progress') {
      this.downloadProgress.set(event.progress);
      return;
    }
    this.downloadProgress.set(null);
    void this.refreshLocalStatus();
    const label = LOCAL_MODELS.find((m) => m.id === event.id)?.label ?? event.id;
    if (event.type === 'done') {
      this.toast.show(`Modèle ${label} téléchargé : l’assistant est prêt.`);
    } else if (event.type === 'cancelled') {
      this.toast.show('Téléchargement annulé.', 'info');
    } else {
      this.toast.show(event.message, 'error');
    }
  }

  private onEvent(event: AiStreamEvent): void {
    if (event.requestId !== this.currentRequest) {
      return;
    }
    if (event.type === 'delta') {
      this.messages.update((list) =>
        list.map((m) => (m.id === event.requestId ? { ...m, content: m.content + event.text } : m)),
      );
    } else if (event.type === 'error') {
      this.fail(event.requestId, event.message);
    } else {
      this.busy.set(false);
      this.currentRequest = null;
      this.messages.update((list) => list.filter((m) => m.id !== event.requestId || m.content !== ''));
    }
  }

  private fail(requestId: string, message: string): void {
    this.busy.set(false);
    this.currentRequest = null;
    this.messages.update((list) =>
      list.map((m) =>
        m.id === requestId
          ? { ...m, content: m.content ? `${m.content}\n\n⚠ ${message}` : message, error: m.content === '' }
          : m,
      ),
    );
  }

  private requireOpenAi(): NonNullable<typeof this.api>['openai'] {
    const openai = this.require().openai;
    if (!openai) {
      throw new Error('OpenAI n’est pas disponible dans cette version de l’application.');
    }
    return openai;
  }

  private requireLocal(): NonNullable<typeof this.api>['local'] {
    const local = this.require().local;
    if (!local) {
      throw new Error('Les modèles open source ne sont pas disponibles dans cette version de l’application.');
    }
    return local;
  }

  private require(): NonNullable<typeof this.api> {
    if (this.api === null) {
      throw new Error('L’assistant IA n’est disponible que dans l’application de bureau.');
    }
    return this.api;
  }
}
