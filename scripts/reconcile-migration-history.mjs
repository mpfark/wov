/** ENG-PROGRESSION-001B-R1: local Git/evidence inventory only. Never executes SQL.
 * Reproduce: node scripts/reconcile-migration-history.mjs [--check]
 * Inputs pinned to TASK_START_SHA; no network, DB client, environment values or runner.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TASK_START_SHA = 'b0a1feb19e009f16ecb899fe7cae94f5940f446e';
export const CLASSIFICATIONS = ['exact_match', 'timestamp_alias', 'generated_alias', 'duplicate_content_alias',
  'installed_but_unrecorded_canonical', 'repository_only', 'ledger_only', 'historical_superseded', 'ambiguous'];
export const ACTIONS = ['no_action', 'recognize_alias_only', 'metadata_repair_candidate', 'requires_installed_inspection',
  'requires_runner_verification', 'requires_separate_migration_analysis', 'block'];
const evidencePath = 'docs/operations/progression-001B-evidence-report.md';
const statePath = 'docs/operations/project-state.json';
const journalPath = 'drizzle/migrations/meta/_journal.json';
const batchHash = '73df81b17ee54a0294e231d2f91a70ecc3a9da37508c027f00674d8181b92b65';
const hash = data => createHash('sha256').update(data).digest('hex');
export const normalizedText = text => text.replaceAll('\r\n', '\n').trimEnd() + '\n';
export function versionSeconds(version) {
  if (!/^\d{14}$/.test(version)) throw new Error(`Invalid timestamp version: ${version}`);
  const iso = `${version.slice(0,4)}-${version.slice(4,6)}-${version.slice(6,8)}T${version.slice(8,10)}:${version.slice(10,12)}:${version.slice(12,14)}Z`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,19) !== iso.slice(0,19)) throw new Error(`Invalid date: ${version}`);
  return ms / 1000;
}
export function expandVersions(list, versions) {
  return list.split(', ').flatMap(token => {
    if (!token.includes('–')) return [token];
    const [start, rest] = token.split('–');
    const end = rest.split(' ')[0];
    return versions.filter(value => value >= start && value <= end);
  });
}
const git = args => execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024 });
function readPinnedFiles(paths) {
  const output = execFileSync('git', ['cat-file', '--batch'], {
    input: paths.map(path => `${TASK_START_SHA}:${path}\n`).join(''), maxBuffer: 128 * 1024 * 1024,
  });
  const result = new Map();
  let position = 0;
  for (const path of paths) {
    const end = output.indexOf(10, position);
    const [oid, type, size] = output.subarray(position, end).toString().split(' ');
    if (type !== 'blob' || !/^\d+$/.test(size)) throw new Error(`Missing pinned blob: ${path}`);
    position = end + 1;
    const bytes = output.subarray(position, position + Number(size));
    result.set(path, { oid, bytes, text: bytes.toString('utf8') });
    position += Number(size) + 1;
  }
  return result;
}
const countBy = (rows, field) => Object.fromEntries([...new Set(rows.map(row => row[field]))].sort().map(key => [key, rows.filter(row => row[field] === key).length]));
const csvCell = value => '"' + (typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')).replaceAll('"', '""') + '"';

export function buildInventory() {
  git(['merge-base', '--is-ancestor', 'c6c63fc20fc5b6c6ebdaa73e5dd9bbae7e3a4f1c', TASK_START_SHA]);
  const tree = git(['ls-tree', '-r', '--name-only', TASK_START_SHA, 'supabase/migrations', 'supabase/pending', 'drizzle/migrations']).toString().trim().split('\n');
  const migrationPaths = tree.filter(path => path.endsWith('.sql')).sort();
  const blobs = readPinnedFiles([...migrationPaths, evidencePath, statePath, journalPath]);
  const evidence = blobs.get(evidencePath).text;
  const state = JSON.parse(blobs.get(statePath).text);
  const journal = JSON.parse(blobs.get(journalPath).text);
  const introductions = new Map();
  let currentCommit, currentTime;
  for (const line of git(['log', '--reverse', '--no-renames', '--diff-filter=A', '--format=@@%H%x09%cI', '--name-only', TASK_START_SHA,
    '--', 'supabase/migrations', 'supabase/pending', 'drizzle/migrations']).toString().split('\n')) {
    if (line.startsWith('@@')) [currentCommit, currentTime] = line.slice(2).split('\t');
    else if (line && !introductions.has(line)) introductions.set(line, { commit: currentCommit, time: currentTime });
  }
  const baseRows = migrationPaths.map(path => {
    const blob = blobs.get(path);
    const filename = path.split('/').at(-1);
    const version = filename.split('_')[0];
    const sql = blob.text;
    return {
      rowKind: 'repository', path, namespace: path.startsWith('supabase/pending/') ? 'supabase_pending' : path.startsWith('drizzle/') ? 'drizzle' : 'supabase',
      version, name: filename.slice(version.length + 1, -4), gitIntroduction: introductions.get(path) ?? null,
      gitBlobOid: blob.oid, byteSha256: hash(blob.bytes), normalizedTextSha256: hash(normalizedText(sql)),
      sqlObjectNames: [...new Set([...sql.matchAll(/\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|TABLE|TRIGGER)|ALTER\s+(?:TABLE|FUNCTION))\s+([\w.]+)/gi)].map(match => match[1]))].slice(0, 30),
      replaySafety: 'not_approved; source SQL may mutate data/DDL/privileges or require historical predecessor state',
    };
  });
  const supabaseRows = baseRows.filter(row => row.namespace === 'supabase');
  const versions = supabaseRows.map(row => row.version);
  if (new Set(versions).size !== versions.length) throw new Error('Duplicate repository versions require separate reconciliation');
  const unmatchedLine = evidence.split(/\r?\n/).find(line => line.startsWith('- 40 repository versions'));
  if (!unmatchedLine) throw new Error('Expected pinned unmatched evidence not present');
  const listedUnmatched = expandVersions(unmatchedLine.split('`')[1], versions);
  if (listedUnmatched.some(version => !versions.includes(version))) throw new Error('Evidence references missing repository source');
  const freshAliases = new Map([...evidence.matchAll(/`(\d{14})` → (?:ledger )?`(\d{14})`/g)].map(match => [match[1], match[2]]));
  const freshLedger = new Set(['20261001230000', ...freshAliases.values()]);
  const explicitLedgerOnly = ['20260219140203','20260329075051','20260430152859','20260511100550','20260629080343','20260728070225'];
  const historicalMapping = new Map();
  for (const entry of state.database_migrations) {
    const source = entry.identity.match(/^\d{14}/)?.[0];
    if (!source || entry.status !== 'installed') continue;
    const mapped = entry.evidence.match(/(?:[Ll]edger (?:row |entry |version )?(?:version )?|single new ledger version )(\d{14})/)?.[1]
      ?? entry.evidence.match(/ledger artifact supabase\/migrations\/(\d{14})/)?.[1]
      ?? entry.evidence.match(/generated ledger artifact supabase\/migrations\/(\d{14})/)?.[1];
    if (mapped) historicalMapping.set(source, { ledgerVersion: mapped, evidence: `${statePath}:database_migrations[${entry.identity}]`, observedAt: entry.timestamp, sourceEntry: entry });
    // Installed generated artifact identity explicitly established by prior inspection.
    else if (entry.evidence.includes(`contains version ${source} exactly once`)) historicalMapping.set(source, { ledgerVersion: source, evidence: `${statePath}:database_migrations[${entry.identity}]`, observedAt: entry.timestamp, sourceEntry: entry });
  }
  const knownLedger = new Set([...freshLedger, ...explicitLedgerOnly, ...[...historicalMapping.values()].map(value => value.ledgerVersion)]);
  const rows = baseRows.map(row => {
    const duplicates = baseRows.filter(other => other.path !== row.path && other.normalizedTextSha256 === row.normalizedTextSha256).map(other => ({ path: other.path, version: other.version, byteIdentical: other.byteSha256 === row.byteSha256 }));
    const old = historicalMapping.get(row.version);
    const freshAlias = freshAliases.get(row.version);
    let classification = 'ambiguous', proposedAction = 'requires_installed_inspection', confidence = 'unresolved_current_ledger';
    let supabaseHistoryVersion = null, historyEvidence = null, currentLedgerVerified = false;
    if (row.byteSha256 === batchHash && /legacy_browser_privileges/.test(row.name)) {
      classification = 'installed_but_unrecorded_canonical'; proposedAction = row.namespace === 'drizzle' ? 'no_action' : 'metadata_repair_candidate';
      confidence = 'fresh_001B_effect_and_exact_drizzle_artifact'; historyEvidence = `${evidencePath}:H0`; currentLedgerVerified = true;
    } else if (freshAlias || (old && old.ledgerVersion !== row.version)) {
      classification = 'generated_alias'; proposedAction = 'recognize_alias_only'; supabaseHistoryVersion = freshAlias ?? old.ledgerVersion;
      currentLedgerVerified = Boolean(freshAlias); confidence = freshAlias ? 'fresh_001B_alias; statement_hash_not_exported' : 'prior_attributed_installation_alias; current_row_needs_export';
      historyEvidence = freshAlias ? `${evidencePath}:H0 examples` : old.evidence;
    } else if (freshLedger.has(row.version) || old?.ledgerVersion === row.version || [...historicalMapping.values()].some(value => value.ledgerVersion === row.version)) {
      classification = 'exact_match'; proposedAction = 'no_action'; supabaseHistoryVersion = row.version;
      currentLedgerVerified = freshLedger.has(row.version); confidence = currentLedgerVerified ? 'fresh_identity; split_statement_content_unavailable' : 'prior_attributed_ledger_identity; current_row_needs_export';
      historyEvidence = currentLedgerVerified ? `${evidencePath}:H0` : old?.evidence ?? [...historicalMapping.values()].find(value => value.ledgerVersion === row.version).evidence;
    } else if (row.version === '20260915200000') {
      classification = 'repository_only'; proposedAction = 'requires_separate_migration_analysis'; confidence = 'explicit_prior_exclusion; no_new_installation_evidence';
      historyEvidence = `${statePath}:20260915200000 explicitly unapplied; fresh 001B H0 unmatched list`;
    } else if (duplicates.length) {
      classification = 'duplicate_content_alias'; proposedAction = 'requires_installed_inspection'; confidence = 'source_text_equivalence_only';
    }
    return { ...row, classification, proposedAction, confidence, supabaseHistoryVersion,
      currentLedgerVerified, historyEvidence,
      historicalGeneratedIdentity: old?.ledgerVersion ?? null, historicalObservedAt: old?.observedAt ?? null,
      ledgerStatementHashRelationship: 'not_exported_in_001B; no reconstructed ledger bytes assumed',
      alternateRepositoryIdentities: duplicates,
      timestampDeltaSecondsLedgerMinusRepository: supabaseHistoryVersion && /^\d{14}$/.test(row.version) ? versionSeconds(supabaseHistoryVersion) - versionSeconds(row.version) : null,
      drizzleHistoryIdentity: row.byteSha256 === batchHash ? { id: 1, hash: batchHash, createdAt: 1791021613818, journalTag: journal.entries[0].tag } : null,
      namedUnmatchedIn001B: row.namespace === 'supabase' && listedUnmatched.includes(row.version),
      installedObjectEvidence: row.byteSha256 === batchHash ? `${evidencePath}:H0 five function ACLs/full MD5s` : null,
      runnerRisk: row.namespace === 'supabase_pending' ? 'not_supabase_migrations_directory; hosted runner must verify exclusion'
        : row.namespace === 'drizzle' ? 'recorded hash/journal; actual next hosted runner route unverified'
          : 'version-based runner may see source identity as pending; exact planned-set/status evidence required',
    };
  });
  for (const version of explicitLedgerOnly) rows.push({ rowKind: 'ledger_evidence', path: null, namespace: 'supabase_ledger', version, name: null,
    classification: 'ledger_only', proposedAction: 'requires_installed_inspection', confidence: 'fresh_identity_without_proven_source_content',
    supabaseHistoryVersion: version, currentLedgerVerified: true, historyEvidence: `${evidencePath}:H0 six ledger-only/adjacent-pair identities`,
    nearestRepositoryCandidates: supabaseRows.map(row => ({ path: row.path, deltaSeconds: versionSeconds(version) - versionSeconds(row.version) }))
      .filter(candidate => Math.abs(candidate.deltaSeconds) <= 60),
    runnerRisk: 'do_not_delete_or_rekey; content/collision resolution needed', replaySafety: 'not_approved',
  });
  const normalizedGroups = [...new Set(baseRows.map(row => row.normalizedTextSha256))].map(digest => baseRows.filter(row => row.normalizedTextSha256 === digest)).filter(group => group.length > 1);
  const unmatched = rows.filter(row => row.namedUnmatchedIn001B);
  const nearestLocalPairs = explicitLedgerOnly.flatMap(version => supabaseRows.map(row => ({ ledgerVersion: version, repositoryVersion: row.version, deltaSeconds: versionSeconds(version) - versionSeconds(row.version) }))
    .filter(candidate => Math.abs(candidate.deltaSeconds) <= 60));
  const summary = {
    taskStartSha: TASK_START_SHA, schemaVersion: 1, inputs: [evidencePath, statePath, journalPath].map(path => ({ path, blobOid: blobs.get(path).oid, sha256: hash(blobs.get(path).bytes) })),
    repositoryCounts: countBy(baseRows, 'namespace'), classifications: countBy(rows, 'classification'), actions: countBy(rows, 'proposedAction'),
    rows: rows.length, repositoryRows: baseRows.length, additionalLedgerEvidenceRows: explicitLedgerOnly.length,
    reported001B: { repositoryFiles: 545, ledgerRows: 510, exact: 279, drifted: 230, unmatchedLabel: 40 },
    evidenceQuality: { namedUnmatchedActual: listedUnmatched.length, namedUnmatchedDuplicates: listedUnmatched.length - new Set(listedUnmatched).size,
      correctedArithmetic: `279 + 230 + ${listedUnmatched.length} = ${279+230+listedUnmatched.length}`,
      full510LedgerRowsProvided: false, all279ExactMembersProvided: false, all230DriftMembersProvided: false,
      correctionMeaning: '40 label contradicts explicit 36-member expansion and 545 total; raw ledger needed to verify matching partition',
    },
    normalizedDuplicateGroups: normalizedGroups.map(group => ({ hash: group[0].normalizedTextSha256, paths: group.map(row => row.path), byteIdentical: new Set(group.map(row => row.byteSha256)).size === 1 })),
    unmatched: { count: unmatched.length, classifications: countBy(unmatched, 'classification'), sourceCounterpartCount: unmatched.filter(row => row.alternateRepositoryIdentities.length).length,
      noSourceCounterpart: unmatched.filter(row => !row.alternateRepositoryIdentities.length).map(row => row.version) },
    timestampDrift: { claimedAffected: 230, actualPairMembershipAndDeltaDistribution: 'not_reconstructible_without_complete_ledger',
      supportedGeneratedAliasDeltas: rows.filter(row => row.classification === 'generated_alias').map(row => ({ repositoryVersion: row.version, ledgerVersion: row.supabaseHistoryVersion, deltaSeconds: row.timestampDeltaSecondsLedgerMinusRepository, currentLedgerVerified: row.currentLedgerVerified })),
      sixLedgerOnlyNearbyCandidates: nearestLocalPairs, nearbyCandidateDistribution: countBy(nearestLocalPairs, 'deltaSeconds'),
      nearbyMatchesAreNotProvenAliases: true },
    namespaces: { generatedUuidNames: supabaseRows.filter(row => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.name)).length,
      descriptiveNames: supabaseRows.filter(row => !/^[0-9a-f]{8}-/.test(row.name)).length,
      renames: git(['log','--diff-filter=R','--name-status','--format=%H %cI','--find-renames',TASK_START_SHA,'--','supabase/migrations']).toString().trim(),
      drizzleJournal: journal },
    gate: 'remains_blocked', candidateMetadataVersions: ['20261002190000'], permittedMutationsInR1: [],
  };
  return { rows, summary, unmatched };
}

export function renderOutputs(inventory) {
  const { rows, summary, unmatched } = inventory;
  const columns = ['rowKind','namespace','path','version','name','gitIntroduction','gitBlobOid','byteSha256','normalizedTextSha256',
    'supabaseHistoryVersion','currentLedgerVerified','historicalGeneratedIdentity','timestampDeltaSecondsLedgerMinusRepository','drizzleHistoryIdentity',
    'alternateRepositoryIdentities','ledgerStatementHashRelationship','installedObjectEvidence','confidence','classification','proposedAction','historyEvidence','runnerRisk','replaySafety'];
  const csv = [columns.join(','), ...rows.map(row => columns.map(key => csvCell(row[key])).join(','))].join('\n')+'\n';
  const md = `# 001B-R1 — Named unmatched migration decisions\n\nGenerated from pinned Git/evidence only. The 001B label “40” expands to **${unmatched.length}** explicit versions. No ledger statement dump is available; source equivalence is not execution proof. Delta is ledger minus repository timestamp in real seconds, not arithmetic subtraction of YYYYMMDDhhmmss.\n\n| Source version/name | Source-equivalent alternate | History attribution | Class | Action | Replay/next evidence |\n|---|---|---|---|---|---|\n${unmatched.map(row => `| ${row.version} / ${row.name} | ${row.alternateRepositoryIdentities.map(other => other.version).join(', ') || 'none'} | ${row.supabaseHistoryVersion ?? (row.drizzleHistoryIdentity ? 'Drizzle row1; Supabase absent (fresh)' : 'unresolved')} (${row.confidence}) | ${row.classification} | ${row.proposedAction} | No SQL replay; ${row.proposedAction === 'metadata_repair_candidate' ? 'prove metadata-only tool and one-row preservation' : row.proposedAction === 'requires_separate_migration_analysis' ? 'unapplied ADM-025B needs separate analysis, never mark applied' : 'export ledger row/statements and runner planned set'} |`).join('\n')}\n\nThis table covers every explicitly named discrepancy. The four implied additional versions in the “40” label are not invented; complete ledger/matching output is required to establish whether the label was a typo or omitted identities.\n`;
  return new Map([
    ['matrix.json', JSON.stringify(rows, null, 2)+'\n'], ['matrix.csv', csv],
    ['summary.json', JSON.stringify(summary, null, 2)+'\n'], ['unmatched-decisions.md', md],
  ]);
}

export function main(check = false) {
  const inventory = buildInventory();
  const directory = resolve('docs/operations/migration-reconciliation');
  if (!check) mkdirSync(directory, { recursive: true });
  for (const [name, text] of renderOutputs(inventory)) {
    const path = resolve(directory, name);
    if (check) {
      if (readFileSync(path, 'utf8').replaceAll('\r\n','\n') !== text) throw new Error(`Stale generated artifact: ${name}`);
    } else writeFileSync(path, text);
  }
  console.log(JSON.stringify({ taskStartSha: TASK_START_SHA, repositoryCounts: inventory.summary.repositoryCounts,
    classifications: inventory.summary.classifications, unmatched: inventory.summary.unmatched, gate: 'remains_blocked', mode: check ? 'checked' : 'generated' }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Only --check is accepted; no runner/network mode exists');
  main(process.argv.includes('--check'));
}
