import Anthropic from '@anthropic-ai/sdk';
import type { AiChatRequest, AiStreamEvent, AiTestResult } from './shared/ipc-contract';

/** Marge de sortie confortable : la réponse est diffusée en flux, sans risque de délai dépassé. */
export const CHAT_MAX_TOKENS = 64000;

/**
 * Modèles qui acceptent le repli côté serveur `fallbacks: "default"` (API Claude) : si le modèle
 * décline une demande, l'API la relance elle-même sur un modèle adapté, dans le même appel.
 */
const SERVER_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);
const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

type ChatParams = Anthropic.Beta.Messages.MessageCreateParamsStreaming;

/**
 * Requête de conversation. Le contexte (rôle + instantané des données) est identique d'un tour à
 * l'autre : il est mis en cache. Effort « medium » : analyses soignées sans coût excessif.
 */
export function buildChatParams(request: Pick<AiChatRequest, 'model' | 'system' | 'messages'>): ChatParams {
  return {
    model: request.model,
    max_tokens: CHAT_MAX_TOKENS,
    stream: true,
    system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    output_config: { effort: 'medium' },
    ...(SERVER_FALLBACK_MODELS.has(request.model)
      ? { betas: [SERVER_FALLBACK_BETA], fallbacks: 'default' as const }
      : {}),
  };
}

/** Client minimal utilisé par le service : remplaçable dans les tests. */
export interface AiClient {
  readonly beta: Pick<Anthropic['beta'], 'messages'>;
  readonly models: Pick<Anthropic['models'], 'retrieve'>;
}

export type ClientFactory = (apiKey: string) => AiClient;

const NO_KEY = 'Aucune clé API : ajoutez-la dans les réglages.';

/** Appels à l'API Claude, faits uniquement depuis le process principal : la clé n'atteint jamais la page. */
export class AiService {
  private readonly running = new Map<string, AbortController>();

  constructor(
    /** Fournit la clé API déchiffrée, ou `null` si aucune clé n'est enregistrée. */
    private readonly apiKey: () => Promise<string | null>,
    private readonly createClient: ClientFactory,
  ) {}

  /** Vérifie la clé et le modèle sans générer de texte (aucun jeton facturé). */
  async test(model: string): Promise<AiTestResult> {
    try {
      const client = await this.client();
      await client.models.retrieve(model);
      return { ok: true, message: 'Connexion réussie : la clé et le modèle fonctionnent.' };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  async chat(request: AiChatRequest, emit: (event: AiStreamEvent) => void): Promise<void> {
    const controller = new AbortController();
    this.running.set(request.requestId, controller);
    const { requestId } = request;
    try {
      const client = await this.client();
      const stream = client.beta.messages.stream(buildChatParams(request), { signal: controller.signal });
      stream.on('text', (text) => emit({ requestId, type: 'delta', text }));
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') {
        emit({ requestId, type: 'error', message: 'Claude a refusé de répondre à cette demande.' });
        return;
      }
      if (message.stop_reason === 'max_tokens') {
        emit({ requestId, type: 'delta', text: '\n\n_(Réponse interrompue : longueur maximale atteinte.)_' });
      }
      emit({ requestId, type: 'done' });
    } catch (error) {
      if (controller.signal.aborted || error instanceof Anthropic.APIUserAbortError) {
        emit({ requestId, type: 'done' });
      } else {
        emit({ requestId, type: 'error', message: errorMessage(error) });
      }
    } finally {
      this.running.delete(requestId);
    }
  }

  abort(requestId: string): void {
    this.running.get(requestId)?.abort();
  }

  private async client(): Promise<AiClient> {
    const key = await this.apiKey();
    if (key === null) {
      throw new Error(NO_KEY);
    }
    return this.createClient(key);
  }
}

/** Message lisible pour une erreur de l'API (classes d'erreur typées du SDK, de la plus précise à la plus générale). */
export function errorMessage(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'Clé API refusée : vérifiez-la dans les réglages.';
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return `Accès refusé avec cette clé API (${error.message}).`;
  }
  if (error instanceof Anthropic.NotFoundError) {
    return 'Modèle introuvable : choisissez un autre modèle dans les réglages.';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Limite d’utilisation atteinte, réessayez dans un instant.';
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `Requête refusée par Claude (${error.message}).`;
  }
  if (error instanceof Anthropic.InternalServerError) {
    return 'Le service Claude est momentanément indisponible, réessayez dans un instant.';
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'Impossible de joindre le service Claude : vérifiez la connexion internet.';
  }
  if (error instanceof Anthropic.APIError) {
    return `Erreur ${error.status ?? ''} du service Claude (${error.message}).`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Client réel ; `baseURL` n'est remplacé qu'en développement (serveur de test local). */
export function sdkClientFactory(baseURL?: string): ClientFactory {
  return (apiKey) => new Anthropic({ apiKey, authToken: null, maxRetries: 2, ...(baseURL ? { baseURL } : {}) });
}
