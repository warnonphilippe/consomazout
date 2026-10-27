import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { AiService } from '../../core/ai/ai.service';
import { renderMarkdown } from '../../pages/help/markdown';
import { IconComponent } from '../icon.component';

const SUGGESTIONS = [
  'Quand dois-je commander le prochain plein, et combien ?',
  'Fais-moi une analyse de ma consommation des 12 derniers mois.',
  'Ma consommation est-elle normale pour une maison belge ?',
  'Y a-t-il des relevés ou des livraisons suspects à vérifier ?',
  'Combien m’a coûté le mazout par an, et comment évolue le prix ?',
] as const;

@Component({
  selector: 'app-assistant-panel',
  imports: [IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './assistant-panel.component.html',
  styleUrl: './assistant-panel.component.css',
})
export class AssistantPanelComponent {
  protected readonly ai = inject(AiService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  protected readonly draft = signal('');
  protected readonly suggestions = SUGGESTIONS;

  /** Réponses rendues en Markdown (le HTML est échappé par le convertisseur). */
  protected readonly rendered = computed<
    { id: string; role: 'user' | 'assistant'; error: boolean; empty: boolean; html: SafeHtml }[]
  >(() =>
    this.ai.messages().map((m) => ({
      id: m.id,
      role: m.role,
      error: m.error === true,
      empty: m.content === '',
      html:
        m.role === 'assistant' && !m.error
          ? this.sanitizer.bypassSecurityTrustHtml(renderMarkdown(m.content).html)
          : this.sanitizer.bypassSecurityTrustHtml(escape(m.content).replace(/\n/g, '<br>')),
    })),
  );

  constructor() {
    effect(() => {
      this.ai.messages();
      queueMicrotask(() => {
        const el = this.list()?.nativeElement;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    });
  }

  protected send(text: string = this.draft()): void {
    if (text.trim() === '' || this.ai.busy()) {
      return;
    }
    this.draft.set('');
    void this.ai.send(text);
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
  }
}

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
