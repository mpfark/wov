import { describe, it, expect } from 'vitest';
import { parseGuideBody } from '@/features/guide/components/GuideBody';

describe('parseGuideBody', () => {
  it('parses headings, paragraphs, asides and cautions', () => {
    const blocks = parseGuideBody('# Title\nline one\nline two\n\n> aside\n! careful');
    expect(blocks).toEqual([
      { kind: 'heading', text: 'Title' },
      { kind: 'para', text: 'line one line two' },
      { kind: 'aside', text: 'aside' },
      { kind: 'warn', text: 'careful' },
    ]);
  });

  it('groups consecutive bullets and numbered steps', () => {
    const blocks = parseGuideBody('- a\n- b\n\n1. first\n2. second');
    expect(blocks).toEqual([
      { kind: 'ul', items: ['a', 'b'] },
      { kind: 'ol', items: ['first', 'second'] },
    ]);
  });

  it('never emits raw markup blocks', () => {
    const blocks = parseGuideBody('<script>alert(1)</script>');
    expect(blocks).toEqual([{ kind: 'para', text: '<script>alert(1)</script>' }]);
  });
});
