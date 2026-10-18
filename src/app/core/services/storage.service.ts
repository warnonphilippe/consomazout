import { Injectable } from '@angular/core';
import type { ConsoMazoutApi, ExportKind, ThemeMode } from '../../../../electron/shared/ipc-contract';

declare global {
  interface Window {
    consoMazout?: ConsoMazoutApi;
  }
}

const LOCAL_KEY = 'consomazout.data';

export interface StoredData {
  readonly content: string | null;
  /** Chemin du fichier de données (application de bureau uniquement). */
  readonly path: string | null;
  readonly recoveredFromBackup: boolean;
}

/**
 * Accès au stockage : fichier JSON via le process principal Electron,
 * ou localStorage quand l'application tourne dans un simple navigateur (développement).
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly api = typeof window !== 'undefined' ? (window.consoMazout ?? null) : null;

  readonly isDesktop = this.api !== null;
  readonly platform = this.api?.platform ?? 'web';

  async load(): Promise<StoredData> {
    if (this.api) {
      return this.api.data.load();
    }
    return { content: safeLocalGet(), path: null, recoveredFromBackup: false };
  }

  async save(content: string): Promise<void> {
    if (this.api) {
      await this.api.data.save(content);
      return;
    }
    localStorage.setItem(LOCAL_KEY, content);
  }

  /** Renvoie le chemin choisi (bureau), `'download'` (navigateur) ou `null` si annulé. */
  async exportFile(content: string, suggestedName: string, kind: ExportKind): Promise<string | null> {
    if (this.api) {
      return this.api.data.exportFile(content, suggestedName, kind);
    }
    const type = kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json';
    const url = URL.createObjectURL(new Blob([kind === 'csv' ? '﻿' + content : content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'download';
  }

  async importFile(): Promise<string | null> {
    if (this.api) {
      return this.api.data.importFile();
    }
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        file.text().then(resolve, () => resolve(null));
      };
      input.click();
    });
  }

  async reveal(): Promise<void> {
    await this.api?.data.reveal();
  }

  async setTheme(mode: ThemeMode): Promise<void> {
    await this.api?.theme.set(mode);
  }
}

function safeLocalGet(): string | null {
  try {
    return localStorage.getItem(LOCAL_KEY);
  } catch {
    return null;
  }
}
