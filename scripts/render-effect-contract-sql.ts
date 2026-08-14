/**
 * Render `supabase/contract/active_effects_validate.sql` from the TypeScript
 * effect contract. Run with `--check` to fail on drift instead of writing.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { buildEffectContractSql } from '../src/shared/combat/pure/effect-contract-sql';

const target = new URL('../supabase/contract/active_effects_validate.sql', import.meta.url).pathname;
const want = buildEffectContractSql();
if (process.argv.includes('--check')) {
  const have = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (have !== want) {
    console.error('effect contract SQL drift: regenerate with bun run scripts/render-effect-contract-sql.ts');
    process.exit(1);
  }
  console.log('effect contract SQL: in sync');
} else {
  writeFileSync(target, want);
  console.log(`wrote ${target}`);
}
