/**
 * Modèles open source (Qwen3, licence Apache 2.0) proposés pour l'assistant quand l'utilisateur n'a pas de
 * clé API Claude. Ils tournent sur l'ordinateur, dans l'application (moteur llama.cpp embarqué), et sont
 * téléchargés depuis les dépôts officiels Qwen sur Hugging Face.
 *
 * Fichier partagé entre le process principal et la page (valeurs, pas seulement des types) ;
 * le preload ne doit pas l'importer.
 */

export interface LocalModelInfo {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Adresse du fichier GGUF (schéma `hf:` compris par node-llama-cpp). */
  readonly uri: string;
  /** Nom du fichier enregistré dans le dossier des modèles. */
  readonly fileName: string;
  /** Taille exacte du fichier, en octets. */
  readonly sizeBytes: number;
  /** Mémoire vive conseillée, en Go. */
  readonly ramGb: number;
}

export const LOCAL_MODELS: readonly LocalModelInfo[] = [
  {
    id: 'qwen3-1.7b',
    label: 'Qwen3 1.7B (léger)',
    description: 'Le plus rapide, pour les ordinateurs modestes. Réponses plus simples.',
    uri: 'hf:Qwen/Qwen3-1.7B-GGUF/Qwen3-1.7B-Q8_0.gguf',
    fileName: 'Qwen3-1.7B-Q8_0.gguf',
    sizeBytes: 1_834_426_016,
    ramGb: 8,
  },
  {
    id: 'qwen3-4b',
    label: 'Qwen3 4B (recommandé)',
    description: 'Bon équilibre entre qualité des analyses et rapidité.',
    uri: 'hf:Qwen/Qwen3-4B-GGUF/Qwen3-4B-Q4_K_M.gguf',
    fileName: 'Qwen3-4B-Q4_K_M.gguf',
    sizeBytes: 2_497_280_256,
    ramGb: 8,
  },
  {
    id: 'qwen3-8b',
    label: 'Qwen3 8B (plus précis)',
    description: 'Analyses plus fines, mais plus lent ; pour les ordinateurs récents.',
    uri: 'hf:Qwen/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf',
    fileName: 'Qwen3-8B-Q4_K_M.gguf',
    sizeBytes: 5_027_783_488,
    ramGb: 16,
  },
];

export const DEFAULT_LOCAL_MODEL = 'qwen3-4b';

export function findLocalModel(id: unknown): LocalModelInfo | undefined {
  return LOCAL_MODELS.find((m) => m.id === id);
}
