import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createLatestRequestGuard, createSubmissionFence } from '../admin-operation-guards';

const ITEM_MANAGER = readFileSync('src/components/admin/ItemManager.tsx', 'utf8');

describe('admin operation guards', () => {
  it('fences duplicate submission until the active write finishes', () => {
    const fence = createSubmissionFence();
    const token = fence.tryAcquire();
    expect(token).not.toBe(false);
    expect(fence.tryAcquire()).toBe(false);
    fence.release(token as number);
    expect(fence.tryAcquire()).not.toBe(false);
  });

  it('does not let an obsolete completion release a newer editor-session lock', () => {
    const fence = createSubmissionFence();
    const old = fence.tryAcquire() as number;
    fence.invalidate();
    const current = fence.tryAcquire() as number;
    expect(fence.release(old)).toBe(false);
    expect(fence.isCurrent(current)).toBe(true);
  });

  it('rejects responses belonging to an older selection', () => {
    const requests = createLatestRequestGuard();
    const first = requests.begin();
    const second = requests.begin();
    expect(requests.isCurrent(first)).toBe(false);
    expect(requests.isCurrent(second)).toBe(true);
  });

  it('invalidates a pending response when an editor closes or enters create mode', () => {
    const requests = createLatestRequestGuard();
    const pending = requests.begin();
    requests.invalidate();
    expect(requests.isCurrent(pending)).toBe(false);
  });

  it('wires item saves, selection loads and deletion through their safety boundaries', () => {
    expect(ITEM_MANAGER).toContain('if (!saveFenceRef.current.tryAcquire()) return;');
    expect(ITEM_MANAGER).toContain('usageRequestGuardRef.current.isCurrent(requestId)');
    expect(ITEM_MANAGER).toContain('usageRequestGuardRef.current.isCurrent(saveSelectionRequest)');
    expect(ITEM_MANAGER).toContain('usageRequestGuardRef.current.invalidate();');
    expect(ITEM_MANAGER).toContain('window.confirm(`Delete item');
  });
});
