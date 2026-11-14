import { describe, expect, it, vi } from 'vitest';
import { reusableRpcClient, roundTiming } from '../../../../supabase/functions/_shared/combat2-rpc-client';

describe('warm combat transport', () => {
  it('reuses the same client while server configuration is unchanged', () => {
    const create = vi.fn(() => ({ rpc: vi.fn() }));
    const pooled = reusableRpcClient(create);
    const first = pooled('http://local', 'fixture-a');
    expect(pooled('http://local', 'fixture-a')).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
    expect(pooled('http://local', 'fixture-b')).not.toBe(first);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('reports rounds of 150ms or longer as outside Mik’s target', () => {
    expect(roundTiming(149).withinTarget).toBe(true);
    expect(roundTiming(150)).toEqual({ elapsedMs: 150, targetMs: 150, withinTarget: false });
    expect(roundTiming(300).withinTarget).toBe(false);
  });
});