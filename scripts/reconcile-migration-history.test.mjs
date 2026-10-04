import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionSeconds, normalizedText, expandVersions, buildInventory, renderOutputs, CLASSIFICATIONS, ACTIONS } from './reconcile-migration-history.mjs';

test('timestamp delta crosses minute/day boundaries correctly; rejects malformed identities', () => {
  assert.equal(versionSeconds('20260301000000')-versionSeconds('20260228235959'), 1);
  assert.equal(versionSeconds('20261001213148')-versionSeconds('20261001130000'), 30708);
  assert.throws(() => versionSeconds('20260230000000'));
  assert.throws(() => versionSeconds('0000'));
});
test('normalization handles only line endings/terminal whitespace, not SQL rewrites', () => {
  assert.equal(normalizedText('SELECT 1;\r\n\r\n'), normalizedText('SELECT 1;'));
  assert.notEqual(normalizedText('SELECT 1;'), normalizedText('SELECT 2;'));
  assert.notEqual(normalizedText('SELECT  1;'), normalizedText('SELECT 1;'));
});
test('explicit range expands actual source members, not nonexistent clock ticks', () => {
  assert.deepEqual(expandVersions('20260915100000–20260915200000 (10 files), 20261002190000', ['20260915100000','20260915120000','20260915200000']),
    ['20260915100000','20260915120000','20260915200000','20261002190000']);
});
test('pinned complete inventory is deterministic and does not infer missing ledgers', () => {
  const first = buildInventory();
  const second = buildInventory();
  assert.deepEqual([...renderOutputs(first)], [...renderOutputs(second)]);
  assert.equal(first.summary.repositoryCounts.supabase, 545);
  assert.equal(first.unmatched.length, 36);
  assert.equal(first.unmatched.filter(row => row.alternateRepositoryIdentities.length).length, 32);
  assert.equal(first.unmatched.filter(row => row.alternateRepositoryIdentities.some(other => other.path.startsWith('supabase/migrations/'))).length, 31);
  assert.equal(first.rows.filter(row => row.classification === 'generated_alias' && row.currentLedgerVerified).length, 3);
  assert.equal(first.summary.evidenceQuality.full510LedgerRowsProvided, false);
  assert.ok(first.rows.every(row => CLASSIFICATIONS.includes(row.classification) && ACTIONS.includes(row.proposedAction)));
  assert.ok(first.rows.filter(row => row.classification === 'ambiguous').length > 200);
  assert.equal(first.rows.filter(row => row.namespace === 'supabase' && row.proposedAction === 'metadata_repair_candidate').length, 1);
  assert.equal(first.rows.find(row => row.version === '20260915200000').classification, 'repository_only');
  assert.equal(first.rows.find(row => row.version === '20261002190000').classification, 'installed_but_unrecorded_canonical');
  assert.equal(first.summary.gate, 'remains_blocked');
});
