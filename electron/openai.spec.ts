import OpenAI from 'openai';
import {
  OPENAI_MAX_OUTPUT_TOKENS,
  OpenAiService,
  buildResponseParams,
  openaiErrorMessage,
  type OpenAiClient,
} from './openai';
import type { AiChatRequest, AiStreamEvent } from './shared/ipc-contract';
import { DEFAULT_OPENAI_MODEL, OPENAI_MODELS, isOpenAiModel } from './shared/openai-models';

const request: AiChatRequest = {
  requestId: 'r1',
  provider: 'openai',
  model: 'gpt-6.1-sol',
  system: 'Contexte : données de la cuve',
  messages: [
    { role: 'user', content: 'Quand commander ?' },
    { role: 'assistant', content: 'Avant le 15 décembre.' },
    { role: 'user', content: 'Combien ?' },
  ],
};

type FakeEvent = Record<string, unknown> & { type: string };

/** Faux flux d'événements de l'API Responses ; peut échouer après les événements. */
function fakeStream(events: FakeEvent[], failWith?: unknown, signal?: AbortSignal) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        await Promise.resolve();
        if (signal?.aborted) {
          throw new OpenAI.APIUserAbortError();
        }
        yield event;
      }
      if (failWith) {
        throw failWith;
      }
    },
  };
}

const delta = (text: string): FakeEvent => ({ type: 'response.output_text.delta', delta: text });
const completed: FakeEvent = { type: 'response.completed', response: { status: 'completed' } };

function fakeClient(
  events: FakeEvent[],
  options: {
    failWith?: unknown;
    onCall?: (params: unknown, opts: { signal: AbortSignal }) => void;
  } = {},
): OpenAiClient {
  return {
    responses: {
      create: async (params: unknown, opts: { signal: AbortSignal }) => {
        options.onCall?.(params, opts);
        return fakeStream(events, options.failWith, opts.signal);
      },
    },
    models: { retrieve: async (id: string) => ({ id }) },
  } as unknown as OpenAiClient;
}

async function run(service: OpenAiService, req: AiChatRequest = request): Promise<AiStreamEvent[]> {
  const events: AiStreamEvent[] = [];
  await service.chat(req, (e) => events.push(e));
  return events;
}

describe('buildResponseParams', () => {
  it('flux, contexte en instructions, historique complet, rien de conservé chez OpenAI', () => {
    expect(buildResponseParams(request)).toEqual({
      model: 'gpt-6.1-sol',
      stream: true,
      store: false,
      instructions: request.system,
      input: [
        { role: 'user', content: 'Quand commander ?' },
        { role: 'assistant', content: 'Avant le 15 décembre.' },
        { role: 'user', content: 'Combien ?' },
      ],
      max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
    });
  });
});

describe('OpenAiService', () => {
  it('relaie le texte en flux puis signale la fin', async () => {
    let seen: unknown;
    const service = new OpenAiService(
      async () => 'sk-proj-test',
      () =>
        fakeClient([delta('Bonjour'), delta(' Philippe'), completed], {
          onCall: (p) => (seen = p),
        }),
    );
    expect(await run(service)).toEqual([
      { requestId: 'r1', type: 'delta', text: 'Bonjour' },
      { requestId: 'r1', type: 'delta', text: ' Philippe' },
      { requestId: 'r1', type: 'done' },
    ]);
    expect(seen).toMatchObject({ model: 'gpt-6.1-sol', store: false });
  });

  it('refus du modèle : message d’erreur', async () => {
    const service = new OpenAiService(
      async () => 'sk-proj-test',
      () => fakeClient([{ type: 'response.refusal.delta', delta: 'Je ne peux pas.' }, completed]),
    );
    expect((await run(service)).at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('refusé'),
    });
  });

  it('réponse coupée à la longueur maximale : mention ajoutée', async () => {
    const service = new OpenAiService(
      async () => 'sk-proj-test',
      () =>
        fakeClient([
          delta('Début'),
          {
            type: 'response.incomplete',
            response: { incomplete_details: { reason: 'max_output_tokens' } },
          },
        ]),
    );
    const events = await run(service);
    expect(events.at(-2)).toMatchObject({
      type: 'delta',
      text: expect.stringContaining('longueur maximale'),
    });
    expect(events.at(-1)).toEqual({ requestId: 'r1', type: 'done' });
  });

  it('échec signalé dans le flux : erreur', async () => {
    const service = new OpenAiService(
      async () => 'sk-proj-test',
      () =>
        fakeClient([{ type: 'response.failed', response: { error: { message: 'server_error' } } }]),
    );
    expect((await run(service)).at(-1)).toMatchObject({ type: 'error', message: 'server_error' });
  });

  it('sans clé : erreur explicite, aucun appel', async () => {
    const factory = vi.fn();
    const service = new OpenAiService(async () => null, factory);
    expect((await run(service)).at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('clé API OpenAI'),
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it('erreur d’authentification traduite', async () => {
    const error = new OpenAI.AuthenticationError(
      401,
      { message: 'bad key' },
      'Incorrect API key',
      new Headers(),
    );
    const service = new OpenAiService(
      async () => 'sk-proj-test',
      () => fakeClient([delta('…')], { failWith: error }),
    );
    expect((await run(service)).at(-1)).toEqual({
      requestId: 'r1',
      type: 'error',
      message: 'Clé API OpenAI refusée : vérifiez-la dans les réglages.',
    });
  });

  it('arrêt demandé : fin du flux sans erreur', async () => {
    let signal: AbortSignal | undefined;
    const service = new OpenAiService(
      async () => 'sk-proj-test',
      () =>
        fakeClient([delta('a'), delta('b'), delta('c')], {
          onCall: (_p, o) => (signal = o.signal),
        }),
    );
    const events: AiStreamEvent[] = [];
    await service.chat(request, (e) => {
      events.push(e);
      service.abort('r1');
    });
    expect(signal?.aborted).toBe(true);
    expect(events.at(-1)).toEqual({ requestId: 'r1', type: 'done' });
    expect(events.filter((e) => e.type === 'delta')).toHaveLength(1);
  });

  it('test de connexion : modèle vérifié sans génération', async () => {
    const ok = new OpenAiService(
      async () => 'sk-proj-test',
      () => fakeClient([]),
    );
    expect(await ok.test('gpt-6.1-sol')).toMatchObject({ ok: true });
    const notFound = new OpenAiService(
      async () => 'sk-proj-test',
      () =>
        ({
          ...fakeClient([]),
          models: {
            retrieve: async () => {
              throw new OpenAI.NotFoundError(404, {}, 'model not found', new Headers());
            },
          },
        }) as unknown as OpenAiClient,
    );
    expect(await notFound.test('gpt-6.1-sol')).toMatchObject({
      ok: false,
      message: expect.stringContaining('Modèle introuvable'),
    });
  });
});

describe('openaiErrorMessage', () => {
  it('erreurs typées du SDK', () => {
    expect(
      openaiErrorMessage(new OpenAI.RateLimitError(429, {}, 'quota', new Headers())),
    ).toContain('crédit');
    expect(openaiErrorMessage(new OpenAI.APIConnectionError({ message: 'offline' }))).toContain(
      'connexion internet',
    );
    expect(
      openaiErrorMessage(new OpenAI.InternalServerError(500, {}, 'oops', new Headers())),
    ).toContain('indisponible');
    expect(openaiErrorMessage(new Error('autre'))).toBe('autre');
  });
});

describe('catalogue des modèles OpenAI', () => {
  it('modèle par défaut présent, identifiants uniques', () => {
    expect(isOpenAiModel(DEFAULT_OPENAI_MODEL)).toBe(true);
    expect(new Set(OPENAI_MODELS.map((m) => m.id)).size).toBe(OPENAI_MODELS.length);
    expect(isOpenAiModel('claude-opus-5-5')).toBe(false);
  });
});
