import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync('src/components/admin/NodeEditorPanel.tsx', 'utf8');

describe('vendor unique exclusion', () => {
  it('filters unique items and rejects a stale selection before writing', () => {
    expect(SOURCE).toContain("i.rarity !== 'unique'");
    expect(SOURCE).toContain("?.rarity === 'unique'");
    expect(SOURCE).toContain('Globally unique items cannot be stocked by vendors');
  });
});
