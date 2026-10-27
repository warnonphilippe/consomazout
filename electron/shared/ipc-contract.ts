/**
 * Contrat entre le process principal et la page, partagé par les deux côtés.
 * Ne contient que des types : il est effacé à la compilation.
 */

export type ThemeMode = 'system' | 'light' | 'dark';

export type ExportKind = 'json' | 'csv';

export interface LoadResult {
  /** Contenu brut du fichier de données, ou `null` au premier démarrage. */
  readonly content: string | null;
  /** Chemin absolu du fichier de données. */
  readonly path: string;
  /** Renseigné quand le fichier principal était illisible et que la copie `.bak` a été utilisée. */
  readonly recoveredFromBackup: boolean;
}

export interface AiStatus {
  /** Une clé API est enregistrée (elle n'est jamais renvoyée à la page). */
  readonly hasKey: boolean;
  /** Le chiffrement du système (Trousseau macOS, DPAPI Windows) est disponible pour la conserver. */
  readonly encryptionAvailable: boolean;
}

export interface AiMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface AiChatRequest {
  /** Identifiant choisi par la page pour rattacher les événements du flux à la conversation. */
  readonly requestId: string;
  readonly model: string;
  /** Contexte : rôle de l'assistant et instantané de toutes les données de l'application. */
  readonly system: string;
  readonly messages: readonly AiMessage[];
}

export type AiStreamEvent =
  | { readonly requestId: string; readonly type: 'delta'; readonly text: string }
  | { readonly requestId: string; readonly type: 'done' }
  | { readonly requestId: string; readonly type: 'error'; readonly message: string };

export interface AiTestResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface ConsoMazoutApi {
  readonly platform: string;
  readonly data: {
    load(): Promise<LoadResult>;
    save(content: string): Promise<void>;
    /** Ouvre « Enregistrer sous » ; renvoie le chemin choisi, ou `null` si annulé. */
    exportFile(content: string, suggestedName: string, kind: ExportKind): Promise<string | null>;
    /** Ouvre « Ouvrir » sur un fichier JSON ; renvoie son contenu, ou `null` si annulé. */
    importFile(): Promise<string | null>;
    /** Affiche le fichier de données dans le Finder / l'Explorateur. */
    reveal(): Promise<void>;
  };
  readonly theme: {
    set(mode: ThemeMode): Promise<void>;
  };
  readonly ai: {
    status(): Promise<AiStatus>;
    /** Enregistre (chiffrée) ou efface (`null`) la clé API. */
    setKey(key: string | null): Promise<AiStatus>;
    /** Vérifie la clé et le modèle sans générer de texte. */
    test(model: string): Promise<AiTestResult>;
    /** Lance une réponse en flux ; les morceaux arrivent par `onEvent`, la promesse se termine avec le flux. */
    chat(request: AiChatRequest): Promise<void>;
    abort(requestId: string): Promise<void>;
    onEvent(listener: (event: AiStreamEvent) => void): () => void;
  };
}

export const IPC = {
  load: 'data:load',
  save: 'data:save',
  exportFile: 'data:export',
  importFile: 'data:import',
  reveal: 'data:reveal',
  theme: 'theme:set',
  aiStatus: 'ai:status',
  aiSetKey: 'ai:setKey',
  aiTest: 'ai:test',
  aiChat: 'ai:chat',
  aiAbort: 'ai:abort',
  aiEvent: 'ai:event',
} as const;
