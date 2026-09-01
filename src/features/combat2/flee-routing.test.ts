import { describe, expect, it, vi } from 'vitest';
import { authorizeCombat2MovementFlee } from './flee-routing';

describe('Combat2 movement/flee authority switch', () => {
  it('flag-off seam performs legacy flee and no Combat2 request', async () => {
    const legacy = vi.fn();
    const combat2 = vi.fn();
    await expect(authorizeCombat2MovementFlee(undefined, legacy)).resolves.toBe(true);
    expect(legacy).toHaveBeenCalledOnce();
    expect(combat2).not.toHaveBeenCalled();
  });

  it('authoritative success continues movement without legacy mutation', async () => {
    const legacy = vi.fn();
    await expect(authorizeCombat2MovementFlee(vi.fn().mockResolvedValue(true), legacy)).resolves.toBe(true);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('authoritative refusal blocks movement without legacy fallback', async () => {
    const legacy = vi.fn();
    await expect(authorizeCombat2MovementFlee(vi.fn().mockResolvedValue(false), legacy)).resolves.toBe(false);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('is mounted behind the shared flag and contains no direct state-table writes', () => {
    const page = readFileSync('src/pages/GamePage.tsx', 'utf8');
    const movement = readFileSync('src/features/world/hooks/useMovementActions.ts', 'utf8');
    const flee = readFileSync('src/features/combat2/flee.ts', 'utf8');
    const session = readFileSync('src/features/combat2/useCombat2FleeSession.ts', 'utf8');
    expect(page).toContain('authorizeCombat2Flee: COMBAT2_CLIENT_ENABLED ? authorizeCombat2Flee : undefined');
    expect(movement).toMatch(/if \(!authoritativeFlee\) \{/);
    expect(`${flee}\n${session}`).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|delete|upsert)\(/);
    expect(`${flee}\n${session}`).not.toMatch(/node_(?:fighter|encounter|participation|creature|pending_event)/);
  });
});
import { readFileSync } from 'node:fs';
