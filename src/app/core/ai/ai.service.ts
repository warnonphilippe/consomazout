import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { AiStatus, AiStreamEvent, AiTestResult } from '../../../../electron/shared/ipc-contract';
import type { AppData } from '../models/app-data.model';
import { newId } from '../models/normalize';
import { DataStore } from '../services/data-store.service';
import { buildSystemPrompt } from './ai-context';

export interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly error?: boolean;
}

/** Assistant Claude : état de la conversation et clé API (jamais lue par la page). */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly store = inject(DataStore);
  private readonly api = typeof window !== 'undefined' ? (window.consoMazout?.ai ?? null) : null;

  /** Les appels à Claude passent par l'application de bureau ; indisponibles dans un simple navigateur. */
  readonly available = this.api !== null;
  readonly status = signal<AiStatus>({ hasKey: false, encryptionAvailable: false });

  readonly open = signal(false);
  readonly messages = signal<ChatMessage[]>([]);
  readonly busy = signal(false);
  private currentRequest: string | null = null;

  /**
   * Contexte figé pour la conversation en cours : identique d'un tour à l'autre, il reste en cache
   * côté Claude. Il est reconstruit seulement si les données changent.
   */
  private context: { data: AppData; system: string } | null = null;

  constructor() {
    if (this.api !== null) {
      const off = this.api.onEvent((event) => this.onEvent(event));
      inject(DestroyRef).onDestroy(off);
      void this.refreshStatus();
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
    try {
      await api.chat({
        requestId,
        model: this.store.settings().aiModel,
        system: this.systemPrompt(),
        messages: history,
      });
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

  private systemPrompt(): string {
    const data = this.store.data();
    if (this.context === null || this.context.data !== data) {
      this.context = { data, system: buildSystemPrompt(data, this.store.analysis(), this.store.now()) };
    }
    return this.context.system;
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

  private require(): NonNullable<typeof this.api> {
    if (this.api === null) {
      throw new Error('L’assistant IA n’est disponible que dans l’application de bureau.');
    }
    return this.api;
  }
}
