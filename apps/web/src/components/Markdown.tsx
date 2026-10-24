import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Markdown da base de conhecimento (item 63), desenhado por nos mesmos: o texto
 * vira elementos React, nunca HTML (nada de dangerouslySetInnerHTML).
 *
 * Blocos: titulos (# a ###), paragrafos, listas (- * 1.), citacoes (>), blocos
 * de codigo (```), linha horizontal (---). Em linha: `codigo`, **negrito**,
 * *italico* / _italico_ e [texto](link). So viram link enderecos http/https e
 * caminhos do proprio app (/...); URL solta fica como texto (artigos citam
 * dominios maliciosos e ninguem deve clicar sem querer).
 */

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  const isList = (line: string) => /^\s*([-*]|\d+[.)])\s+/.test(line);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s*```/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++; // fecha o bloco (ou fim do texto)
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      // h1 do texto vira h2 (o titulo do artigo ja e o h1 da pagina).
      blocks.push({
        kind: 'heading',
        level: Math.min(heading[1].length + 1, 6),
        text: heading[2].trim(),
      });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]))
        body.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ kind: 'quote', text: body.join('\n') });
      continue;
    }
    if (isList(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && lines[i].trim()) {
        const item = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (item) items.push(item[2]);
        // Linha de continuacao do item anterior.
        else if (items.length) items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !isList(lines[i])
    ) {
      body.push(lines[i++].trim());
    }
    blocks.push({ kind: 'paragraph', text: body.join(' ') });
  }
  return blocks;
}

/** Link permitido: http(s) ou caminho do app; o resto vira texto. */
export function safeHref(href: string): { internal: boolean; href: string } | null {
  const h = href.trim();
  if (/^\/(?![/\\])/.test(h)) return { internal: true, href: h };
  try {
    const url = new URL(h);
    if (url.protocol === 'http:' || url.protocol === 'https:')
      return { internal: false, href: url.href };
  } catch {
    /* nao e URL */
  }
  return null;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/;

export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const token = m[0];
    const key = `${keyPrefix}-${n++}`;
    if (m[1]) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    else if (m[3]) out.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!;
      const target = safeHref(link[2]);
      const label = renderInline(link[1], key);
      if (!target) out.push(<span key={key}>{label}</span>);
      else if (target.internal) {
        out.push(
          <Link key={key} className="dl-link" to={target.href}>
            {label}
          </Link>,
        );
      } else {
        out.push(
          <a
            key={key}
            className="dl-link"
            href={target.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {label}
          </a>,
        );
      }
    }
    rest = rest.slice(m.index + token.length);
  }
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className="dl-markdown">
      {blocks.map((block, i) => {
        const key = `b${i}`;
        switch (block.kind) {
          case 'heading': {
            const Tag = `h${block.level}` as 'h2';
            return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
          }
          case 'paragraph':
            return <p key={key}>{renderInline(block.text, key)}</p>;
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
              <Tag key={key}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </Tag>
            );
          }
          case 'quote':
            return (
              <blockquote key={key}>
                {block.text.split('\n').map((line, j) => (
                  <p key={j}>{renderInline(line, `${key}-${j}`)}</p>
                ))}
              </blockquote>
            );
          case 'code':
            return (
              <pre key={key}>
                <code>{block.text}</code>
              </pre>
            );
          case 'rule':
            return <hr key={key} />;
        }
      })}
    </div>
  );
}
