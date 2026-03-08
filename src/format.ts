// Copilot Remote — Markdown → Telegram HTML converter
// Converts common markdown patterns to Telegram-supported HTML.
// Telegram supports: <b>, <i>, <code>, <pre>, <a>, <s>, <u>, <blockquote>, <tg-spoiler>

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block toggle
    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = line.trimStart().slice(3).trim();
        codeLines = [];
      } else {
        // Close code block
        const langAttr = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : '';
        out.push(`<pre><code${langAttr}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCodeBlock = false;
        codeLang = '';
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    out.push(convertLine(line));
  }

  // Unclosed code block
  if (inCodeBlock && codeLines.length) {
    const langAttr = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : '';
    out.push(`<pre><code${langAttr}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }

  return out.join('\n');
}

function convertLine(line: string): string {
  // Headers → bold
  const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
  if (headerMatch) {
    return `<b>${convertInline(escapeHtml(headerMatch[2]))}</b>`;
  }

  // Blockquotes
  if (line.startsWith('> ')) {
    return `<blockquote>${convertInline(escapeHtml(line.slice(2)))}</blockquote>`;
  }

  // Horizontal rules
  if (/^[-*_]{3,}\s*$/.test(line)) {
    return '———';
  }

  // Unordered list items
  const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
  if (ulMatch) {
    const indent = ulMatch[1].length >= 2 ? '    ' : '';
    return `${indent}• ${convertInline(escapeHtml(ulMatch[2]))}`;
  }

  // Ordered list items
  const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
  if (olMatch) {
    const indent = olMatch[1].length >= 2 ? '    ' : '';
    return `${indent}${convertInline(escapeHtml(olMatch[2]))}`;
  }

  return convertInline(escapeHtml(line));
}

function convertInline(html: string): string {
  // Inline code (must be before bold/italic to avoid conflicts)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  html = html.replace(/__(.+?)__/g, '<b>$1</b>');

  // Italic
  html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<i>$1</i>');
  html = html.replace(/(?<!_)_([^_]+?)_(?!_)/g, '<i>$1</i>');

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  return html;
}

// Plain text fallback (strip markdown)
export function markdownToText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/^\d+\.\s+/gm, '');
}
