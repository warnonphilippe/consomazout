import Anthropic from '@anthropic-ai/sdk';
import { AiService, CHAT_MAX_TOKENS, buildChatParams, errorMessage, type AiClient } from './ai';
import type { AiStreamEvent } from './shared/ipc-contract';

const request = {
  requestId: 'r1',
  model: 'claude-opus-5-5',
  system: 'Contexte : données de la cuve',
  messages: [{ role: 'user' as const, content: 'Quand commander ?' }],
};

/** Faux flux : émet les morceaux de texte, puis résout le message final. */
function fakeStream(chunks: string[], stopReason = 'end_turn', failWith?: unknown) {
  const listeners: ((text: string) => void)[] = [];
  return {
    on(event: string, listener: (text: string) => void) {
      if (event === 'text') {
        listeners.push(listener);
      }
      return this;
    },
    async finalMessage() {
      for (const chunk of chunks) {
        listeners.forEach((l) => l(chunk));
      }
      if (failWith) {
        throw failWith;
      }
      return { stop_reason: stopReason, content: [] };
    },
  };
}

function fakeClient(stream: ReturnType<typeof fakeStream>, onParams?: (params: unknown, options: unknown) => void): AiClient {
  return {
    beta: {
      messages: {
        stream: (params: unknown, options: unknown) => {
          onParams?.(params, options);
          return stream;
        },
      },
    },
    models: { retrieve: async (id: string) => ({ id }) },
  } as unknown as AiClient;
}

async function run(service: AiService): Promise<AiStreamEvent[]> {
  const events: AiStreamEvent[] = [];
  await service.chat(request, (e) => events.push(e));
  return events;
}

describe('buildChatParams', () => {
  it('flux, contexte mis en cache, effort explicite et repli serveur pour Opus 5.5', () => {
    const params = buildChatParams(request);
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: CHAT_MAX_TOKENS,
      stream: true,
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'Quand commander ?' }],
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect(params).not.toHaveProperty('thinking');
  });

  it('pas de repli serveur pour Haiku 5.5', () => {
    const params = buildChatParams({ ...request, model: 'claude-haiku-5-5' });
    expect(params).not.toHaveProperty('fallbacks');
    expect(params).not.toHaveProperty('betas');
  });
});

describe('AiService', () => {
  it('relaie le texte en flux puis signale la fin', async () => {
    let seen: unknown;
    const service = new AiService(async () => 'sk-ant-test', () =>
      fakeClient(fakeStream(['Bonjour', ' Philippe']), (params) => (seen = params)),
    );
    expect(await run(service)).toEqual([
      { requestId: 'r1', type: 'delta', text: 'Bonjour' },
      { requestId: 'r1', type: 'delta', text: ' Philippe' },
      { requestId: 'r1', type: 'done' },
    ]);
    expect(seen).toMatchObject({ model: 'claude-opus-5-5' });
  });

  it('refus du modèle : message d’erreur', async () => {
    const service = new AiService(async () => 'sk-ant-test', () => fakeClient(fakeStream([], 'refusal')));
    expect((await run(service)).at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('refusé') });
  });

  it('sans clé : erreur explicite, aucun appel', async () => {
    const factory = vi.fn();
    const service = new AiService(async () => null, factory);
    expect((await run(service)).at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('clé API') });
    expect(factory).not.toHaveBeenCalled();
  });

  it('erreur d’authentification traduite', async () => {
    const error = new Anthropic.AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', new Headers());
    const service = new AiService(async () => 'sk-ant-test', () => fakeClient(fakeStream(['…'], 'end_turn', error)));
    expect((await run(service)).at(-1)).toEqual({
      requestId: 'r1',
      type: 'error',
      message: 'Clé API refusée : vérifiez-la dans les réglages.',
    });
  });

  it('arrêt demandé : fin du flux sans erreur', async () => {
    let signal: AbortSignal | undefined;
    const stream = fakeStream([], 'end_turn', new Anthropic.APIUserAbortError());
    const service = new AiService(async () => 'sk-ant-test', () =>
      fakeClient(stream, (_params, options) => (signal = (options as { signal: AbortSignal }).signal)),
    );
    const done = run(service);
    await Promise.resolve();
    service.abort('r1');
    expect((await done).at(-1)).toEqual({ requestId: 'r1', type: 'done' });
    expect(signal).toBeDefined();
  });

  it('test de connexion : modèle vérifié sans génération', async () => {
    const ok = new AiService(async () => 'sk-ant-test', () => fakeClient(fakeStream([])));
    expect(await ok.test('claude-opus-5-5')).toMatchObject({ ok: true });
    const notFound = new AiService(async () => 'sk-ant-test', () => ({
      ...fakeClient(fakeStream([])),
      models: {
        retrieve: async () => {
          throw new Anthropic.NotFoundError(404, {}, 'model not found', new Headers());
        },
      },
    }) as unknown as AiClient);
    expect(await notFound.test('claude-inconnu')).toEqual({
      ok: false,
      message: 'Modèle introuvable : choisissez un autre modèle dans les réglages.',
    });
  });
});

describe('errorMessage', () => {
  it('erreurs typées du SDK', () => {
    expect(errorMessage(new Anthropic.RateLimitError(429, {}, 'slow down', new Headers()))).toContain('Limite');
    expect(errorMessage(new Anthropic.APIConnectionError({ message: 'offline' }))).toContain('connexion internet');
    expect(errorMessage(new Anthropic.InternalServerError(529, {}, 'overloaded', new Headers()))).toContain('indisponible');
    expect(errorMessage(new Error('autre'))).toBe('autre');
  });
});
