/**
 * Convertisseur Markdown minimal pour le guide utilisateur (contenu de confiance, livré avec l'app) :
 * titres, paragraphes, listes, citations, tableaux, blocs de code, gras, italique, code, liens, images.
 */
export interface MarkdownHeading {
  readonly id: string;
  readonly text: string;
  readonly level: number;
}

export interface MarkdownResult {
  readonly html: string;
  readonly headings: MarkdownHeading[];
}

export function renderMarkdown(source: string, imageBase = ''): MarkdownResult {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const headings: MarkdownHeading[] = [];
  const usedIds = new Set<string>();
  let i = 0;

  const inline = (text: string): string =>
    escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, src: string) => {
        const url = /^(https?:)?\/\//.test(src) ? src : imageBase + src.replace(/^\.?\/?img\//, '');
        return `<img src="${url}" alt="${alt}" loading="lazy">`;
      })
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) =>
        href.startsWith('#')
          ? `<a href="${href}" data-anchor="${href.slice(1)}">${label}</a>`
          : `<a href="${href}" target="_blank" rel="noopener">${label}</a>`,
      )
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1<em>$2</em>');

  const isBlockStart = (line: string): boolean =>
    /^(#{1,6} |```|> |\s*[-*] |\s*\d+\. |\|)/.test(line) || line.trim() === '' || /^---+$/.test(line.trim());

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') {
      i++;
      continue;
    }

    const heading = /^(#{1,6}) (.+)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const text = heading[2]!.trim();
      const id = uniqueId(slugify(text), usedIds);
      headings.push({ id, text: stripInline(text), level });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        code.push(lines[i]!);
        i++;
      }
      i++;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (line.startsWith('> ')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) {
        quote.push(lines[i]!.replace(/^> ?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(quote.join('\n'), imageBase).html}</blockquote>`);
      continue;
    }

    if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith('|')) {
        rows.push(
          lines[i]!
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => c.trim()),
        );
        i++;
      }
      const [head, separator, ...body] = rows;
      const hasHeader = separator !== undefined && separator.every((c) => /^:?-+:?$/.test(c));
      const bodyRows = hasHeader ? body : rows.slice(1);
      out.push('<div class="md-table"><table>');
      if (head) {
        out.push(`<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`);
      }
      out.push(`<tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`);
      out.push('</table></div>');
      continue;
    }

    const listMatch = /^(\s*)([-*]|\d+\.) /.exec(line);
    if (listMatch) {
      const { html, next } = renderList(lines, i, inline);
      out.push(html);
      i = next;
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && !(paragraph.length > 0 && isBlockStart(lines[i]!))) {
      paragraph.push(lines[i]!.trim());
      i++;
    }
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }

  return { html: out.join('\n'), headings };
}

function renderList(lines: string[], start: number, inline: (t: string) => string): { html: string; next: number } {
  const first = /^(\s*)([-*]|\d+\.) /.exec(lines[start]!)!;
  const indent = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    const match = /^(\s*)([-*]|\d+\.) (.*)$/.exec(lines[i]!);
    if (!match || match[1]!.length < indent) {
      if (lines[i]!.trim() !== '' && match === null && lines[i]!.startsWith(' '.repeat(indent + 2)) && items.length > 0) {
        items[items.length - 1] += ' ' + inline(lines[i]!.trim());
        i++;
        continue;
      }
      break;
    }
    if (match[1]!.length > indent) {
      const nested = renderList(lines, i, inline);
      items[items.length - 1] += nested.html;
      i = nested.next;
      continue;
    }
    items.push(inline(match[3]!));
    i++;
    if (i < lines.length && lines[i]!.trim() === '' && /^(\s*)([-*]|\d+\.) /.test(lines[i + 1] ?? '')) {
      i++;
    }
  }
  const tag = ordered ? 'ol' : 'ul';
  return { html: `<${tag}>${items.map((it) => `<li>${it}</li>`).join('')}</${tag}>`, next: i };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripInline(text: string): string {
  return text.replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

export function slugify(text: string): string {
  return stripInline(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base || 'section';
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n++}`;
  }
  used.add(id);
  return id;
}
