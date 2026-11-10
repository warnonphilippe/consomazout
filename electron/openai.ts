import OpenAI from 'openai';
import type { AiChatRequest, AiStreamEvent, AiTestResult } from './shared/ipc-contract';

/** Longueur maximale d'une réponse (en jetons de sortie). */
export const OPENAI_MAX_OUTPUT_TOKENS = 16000;

type ResponseParams = OpenAI.Responses.ResponseCreateParamsStreaming;

/**
 * Requête de conversation (API Responses). Le contexte (rôle + données) passe en `instructions` : identique
 * d'un tour à l'autre, il profite du cache automatique d'OpenAI. `store: false` : OpenAI ne conserve pas
 * les réponses.
 */
export function buildResponseParams(
  request: Pick<AiChatRequest, 'model' | 'system' | 'messages'>,
): ResponseParams {
  return {
    model: request.model,
    stream: true,
    store: false,
    instructions: request.system,
    input: request.messages.map((m) => ({ role: m.role, content: m.content })),
    max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
  };
}

/** Client minimal utilisé par le service : remplaçable dans les tests. */
export interface OpenAiClient {
  readonly responses: Pick<OpenAI['responses'], 'create'>;
  readonly models: Pick<OpenAI['models'], 'retrieve'>;
}

export type OpenAiClientFactory = (apiKey: string) => OpenAiClient;

const NO_KEY = 'Aucune clé API OpenAI : ajoutez-la dans les réglages.';

/** Appels à l'API OpenAI, faits uniquement depuis le process principal : la clé n'atteint jamais la page. */
export class OpenAiService {
  private readonly running = new Map<string, AbortController>();

  constructor(
    /** Fournit la clé API déchiffrée, ou `null` si aucune clé n'est enregistrée. */
    private readonly apiKey: () => Promise<string | null>,
    private readonly createClient: OpenAiClientFactory,
  ) {}

  /** Vérifie la clé et l'accès au modèle sans générer de texte (aucun jeton facturé). */
  async test(model: string): Promise<AiTestResult> {
    try {
      const client = await this.client();
      await client.models.retrieve(model);
      return { ok: true, message: 'Connexion réussie : la clé et le modèle fonctionnent.' };
    } catch (error) {
      return { ok: false, message: openaiErrorMessage(error) };
    }
  }

  async chat(request: AiChatRequest, emit: (event: AiStreamEvent) => void): Promise<void> {
    const controller = new AbortController();
    const { requestId } = request;
    this.running.set(requestId, controller);
    try {
      const client = await this.client();
      const stream = await client.responses.create(buildResponseParams(request), {
        signal: controller.signal,
      });
      let refusal = '';
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') {
          emit({ requestId, type: 'delta', text: event.delta });
        } else if (event.type === 'response.refusal.delta') {
          refusal += event.delta;
        } else if (event.type === 'response.incomplete') {
          const reason = event.response.incomplete_details?.reason;
          if (reason === 'max_output_tokens') {
            emit({
              requestId,
              type: 'delta',
              text: '\n\n_(Réponse interrompue : longueur maximale atteinte.)_',
            });
          } else if (reason === 'content_filter') {
            throw new Error('OpenAI a interrompu la réponse (filtre de contenu).');
          }
        } else if (event.type === 'response.failed') {
          throw new Error(event.response.error?.message ?? 'La réponse d’OpenAI a échoué.');
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      }
      if (refusal !== '') {
        emit({ requestId, type: 'error', message: 'OpenAI a refusé de répondre à cette demande.' });
        return;
      }
      emit({ requestId, type: 'done' });
    } catch (error) {
      if (controller.signal.aborted || error instanceof OpenAI.APIUserAbortError) {
        emit({ requestId, type: 'done' });
      } else {
        emit({ requestId, type: 'error', message: openaiErrorMessage(error) });
      }
    } finally {
      this.running.delete(requestId);
    }
  }

  abort(requestId: string): void {
    this.running.get(requestId)?.abort();
  }

  private async client(): Promise<OpenAiClient> {
    const key = await this.apiKey();
    if (key === null) {
      throw new Error(NO_KEY);
    }
    return this.createClient(key);
  }
}

/** Message lisible pour une erreur de l'API OpenAI (classes d'erreur typées du SDK). */
export function openaiErrorMessage(error: unknown): string {
  if (error instanceof OpenAI.AuthenticationError) {
    return 'Clé API OpenAI refusée : vérifiez-la dans les réglages.';
  }
  if (error instanceof OpenAI.PermissionDeniedError) {
    return `Accès refusé avec cette clé API OpenAI (${error.message}).`;
  }
  if (error instanceof OpenAI.NotFoundError) {
    return 'Modèle introuvable ou non accessible avec cette clé : choisissez un autre modèle dans les réglages.';
  }
  if (error instanceof OpenAI.RateLimitError) {
    return 'Limite d’utilisation ou crédit OpenAI atteint, réessayez plus tard ou vérifiez votre compte.';
  }
  if (error instanceof OpenAI.BadRequestError) {
    return `Requête refusée par OpenAI (${error.message}).`;
  }
  if (error instanceof OpenAI.InternalServerError) {
    return 'Le service OpenAI est momentanément indisponible, réessayez dans un instant.';
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return 'Impossible de joindre le service OpenAI : vérifiez la connexion internet.';
  }
  if (error instanceof OpenAI.APIError) {
    return `Erreur ${error.status ?? ''} du service OpenAI (${error.message}).`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Client réel ; `baseURL` n'est remplacé qu'en développement (serveur de test local). */
export function openaiClientFactory(baseURL?: string): OpenAiClientFactory {
  return (apiKey) => new OpenAI({ apiKey, maxRetries: 2, ...(baseURL ? { baseURL } : {}) });
}
