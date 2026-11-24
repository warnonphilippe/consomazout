import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { DataStore } from '../services/data-store.service';
import { asElecSummary, summaryFingerprint, type ElecSummary } from './household-summary';
import { buildMazoutSummary } from './mazout-summary';

/** Délai avant publication : regroupe les modifications rapprochées. */
const PUBLISH_DELAY_MS = 2_000;
/** Relecture périodique du résumé de ConsoElec (aussi au retour sur la fenêtre et avant l'assistant). */
const PEER_REFRESH_MS = 5 * 60_000;

/**
 * Lien avec ConsoElec par le dossier `~/.config/conso-maison` : publie le résumé de ConsoMazout (estimation annuelle,
 * 12 derniers mois…) à chaque changement et lit celui de ConsoElec pour l'assistant et le tableau de bord.
 * Les données de démonstration ne sont jamais publiées. Sans application de bureau, le lien est inactif.
 */
@Injectable({ providedIn: 'root' })
export class LinkService {
  private readonly store = inject(DataStore);
  private readonly api = typeof window !== 'undefined' ? (window.consoMazout?.link ?? null) : null;

  /** Résumé publié par ConsoElec, ou `null` (jamais publié, application absente). */
  readonly peer = signal<ElecSummary | null>(null);

  private readonly summary = computed(() => {
    const data = this.store.data();
    if (!this.store.loaded() || data.demo) {
      return null;
    }
    return buildMazoutSummary(data, this.store.analysis(), new Date());
  });

  private published: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (this.api === null) {
      return;
    }
    effect(() => {
      const summary = this.summary();
      if (summary !== null && summaryFingerprint(summary) !== this.published) {
        this.schedulePublish();
      }
    });
    void this.refreshPeer();
    const onFocus = (): void => void this.refreshPeer();
    window.addEventListener('focus', onFocus);
    const interval = setInterval(() => void this.refreshPeer(), PEER_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
      if (this.timer !== null) {
        clearTimeout(this.timer);
      }
    });
  }

  /** Relit le résumé de ConsoElec ; le signal ne change que si son contenu a changé. */
  async refreshPeer(): Promise<void> {
    if (this.api === null) {
      return;
    }
    try {
      const next = asElecSummary(await this.api.read('consoelec'));
      const current = this.peer();
      if (next === null || current === null ? next !== current : next.genereLe !== current.genereLe) {
        this.peer.set(next);
      }
    } catch {
      // Lien indisponible (ancienne version du process principal) : rien à afficher.
    }
  }

  private schedulePublish(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.publish();
    }, PUBLISH_DELAY_MS);
  }

  private async publish(): Promise<void> {
    const summary = this.summary();
    if (this.api === null || summary === null) {
      return;
    }
    const fingerprint = summaryFingerprint(summary);
    if (fingerprint === this.published) {
      return;
    }
    try {
      await this.api.publish(JSON.stringify(summary, null, 2));
      this.published = fingerprint;
    } catch (error) {
      console.warn('Résumé pour ConsoElec non publié :', error);
    }
  }
}
