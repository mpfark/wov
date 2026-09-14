import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(`src/components/admin/${name}`, 'utf8');

describe('admin hardening batch wiring', () => {
  it.each([
    'NPCManager.tsx',
    'RaceManager.tsx',
    'StatusManager.tsx',
    'AreaEditorPanel.tsx',
    'XpBoostPanel.tsx',
    'IssueReportManager.tsx',
    'RoadmapManager.tsx',
  ])('%s uses the shared synchronous submission fence', file => {
    const source = read(file);
    expect(source).toContain('createSubmissionFence');
    expect(source).toContain('.tryAcquire()');
    expect(source).toContain('.release(operation)');
  });

  it.each(['NPCManager.tsx', 'RaceManager.tsx', 'StatusManager.tsx', 'AreaEditorPanel.tsx', 'RoadmapManager.tsx'])(
    '%s scopes late feedback or refreshes to the current editor session',
    file => expect(read(file)).toContain('sessionGuard.current'),
  );

  it('names each deletable record and leaves XP Boost confirmation-free', () => {
    expect(read('NPCManager.tsx')).toContain('Delete NPC');
    expect(read('RaceManager.tsx')).toContain('Delete race');
    expect(read('AreaEditorPanel.tsx')).toContain('Delete area');
    expect(read('IssueReportManager.tsx')).toContain('Delete issue report from');
    expect(read('RoadmapManager.tsx')).toContain('Delete roadmap entry');
    expect(read('XpBoostPanel.tsx')).not.toContain('window.confirm');
  });

  it('retains the existing persistence targets', () => {
    expect(read('NPCManager.tsx')).toContain("from('npcs')");
    expect(read('RaceManager.tsx')).toContain("from('races'");
    expect(read('StatusManager.tsx')).toContain("from('applied_statuses')");
    expect(read('AreaEditorPanel.tsx')).toContain("from('areas')");
    expect(read('XpBoostPanel.tsx')).toContain("from('xp_boost')");
    expect(read('IssueReportManager.tsx')).toContain("from('issue_reports'");
    expect(read('RoadmapManager.tsx')).toContain("from('roadmap_items')");
  });
});
