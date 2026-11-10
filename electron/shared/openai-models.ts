/**
 * Modèles OpenAI proposés pour l'assistant (identifiants exacts de l'API OpenAI, SDK officiel `openai`).
 * Fichier partagé entre le process principal et la page (valeurs) ; le preload ne doit pas l'importer.
 */

export interface OpenAiModelInfo {
  readonly id: string;
  readonly label: string;
}

export const OPENAI_MODELS: readonly OpenAiModelInfo[] = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol (le plus récent)' },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini (rapide, économique)' },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano (le plus économique)' },
];

export const DEFAULT_OPENAI_MODEL = 'gpt-6.1-sol';

export function isOpenAiModel(id: unknown): id is string {
  return OPENAI_MODELS.some((m) => m.id === id);
}
