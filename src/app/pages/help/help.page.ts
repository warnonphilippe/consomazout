import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import guide from '../../../../docs/GUIDE-UTILISATEUR.md';
import { IconComponent } from '../../shared/icon.component';
import { renderMarkdown } from './markdown';

@Component({
  selector: 'app-help-page',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './help.page.html',
  styleUrl: './help.page.css',
})
export default class HelpPage {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly sanitizer = inject(DomSanitizer);

  private readonly rendered = renderMarkdown(guide, 'guide-img/');
  // Guide livré avec l'application (docs/GUIDE-UTILISATEUR.md) : contenu de confiance, déjà échappé.
  protected readonly html = this.sanitizer.bypassSecurityTrustHtml(this.rendered.html);
  protected readonly toc = this.rendered.headings.filter((h) => h.level === 2);
  protected readonly filter = signal('');
  protected readonly filteredToc = computed(() => {
    const q = this.filter().trim().toLowerCase();
    return q ? this.toc.filter((h) => h.text.toLowerCase().includes(q)) : this.toc;
  });

  protected scrollTo(id: string): void {
    this.host.nativeElement.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Les liens internes (#ancre) défilent dans la page au lieu de naviguer. */
  protected onContentClick(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement).closest('a[data-anchor]');
    if (anchor) {
      event.preventDefault();
      this.scrollTo(anchor.getAttribute('data-anchor') ?? '');
    }
  }
}
