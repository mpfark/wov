/**
 * GuideBody — renders guide entry bodies using a small, safe line grammar.
 * No HTML or Markdown is parsed, so authored content can never inject markup.
 *
 * Grammar (per line):
 *   "# Heading"      → section heading
 *   "- item"         → bullet list item (consecutive lines group)
 *   "1. item"        → numbered list item (consecutive lines group)
 *   "> aside"        → italic aside (the Guide's editorial voice)
 *   "! warning"      → highlighted caution line
 *   ""               → paragraph break
 *   anything else    → paragraph text
 *
 * Inline: *emphasis* only.
 */
import { Fragment, type ReactNode } from 'react';

function inline(text: string, keyBase: string): ReactNode[] {
  const parts = text.split(/(\*[^*]+\*)/g);
  return parts.filter(Boolean).map((part, i) => {
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={`${keyBase}-${i}`} className="text-foreground font-medium not-italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <Fragment key={`${keyBase}-${i}`}>{part}</Fragment>;
  });
}

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'aside'; text: string }
  | { kind: 'warn'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] };

export function parseGuideBody(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = (body ?? '').replace(/\r\n/g, '\n').split('\n');
  let paraBuffer: string[] = [];

  const flushPara = () => {
    if (paraBuffer.length) {
      blocks.push({ kind: 'para', text: paraBuffer.join(' ') });
      paraBuffer = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      continue;
    }
    if (line.startsWith('# ')) {
      flushPara();
      blocks.push({ kind: 'heading', text: line.slice(2).trim() });
      continue;
    }
    if (line.startsWith('> ')) {
      flushPara();
      blocks.push({ kind: 'aside', text: line.slice(2).trim() });
      continue;
    }
    if (line.startsWith('! ')) {
      flushPara();
      blocks.push({ kind: 'warn', text: line.slice(2).trim() });
      continue;
    }
    if (line.startsWith('- ')) {
      flushPara();
      const item = line.slice(2).trim();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'ul') last.items.push(item);
      else blocks.push({ kind: 'ul', items: [item] });
      continue;
    }
    const ordered = line.match(/^\d+\.\s+(.*)$/);
    if (ordered) {
      flushPara();
      const item = ordered[1].trim();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'ol') last.items.push(item);
      else blocks.push({ kind: 'ol', items: [item] });
      continue;
    }
    paraBuffer.push(line);
  }
  flushPara();
  return blocks;
}

export function GuideBody({ body }: { body: string }) {
  const blocks = parseGuideBody(body);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'heading':
            return (
              <h3
                key={i}
                className="pt-2 text-base font-semibold tracking-wide text-foreground border-b border-border/60 pb-1"
              >
                {block.text}
              </h3>
            );
          case 'aside':
            return (
              <p key={i} className="border-l-2 border-primary/50 pl-3 italic text-muted-foreground/90">
                {inline(block.text, `a${i}`)}
              </p>
            );
          case 'warn':
            return (
              <p key={i} className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-foreground/90">
                {inline(block.text, `w${i}`)}
              </p>
            );
          case 'ul':
            return (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item, `u${i}-${j}`)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="list-decimal space-y-1 pl-5">
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item, `o${i}-${j}`)}</li>
                ))}
              </ol>
            );
          default:
            return <p key={i}>{inline(block.text, `p${i}`)}</p>;
        }
      })}
    </div>
  );
}
