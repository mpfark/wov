/**
 * C0 — the combat maintenance gate must fail closed.
 *
 * These cases pin the contract both resolvers rely on: only the exact value
 * `open` permits resolution, every other state (missing row, empty string,
 * typo, read failure) closes combat, and the gated response carries no
 * simulated events and no committed batch identity.
 */
import { describe, it, expect } from 'vitest';

import {
  parseCombatMode,
  isMaintenanceResponse,
  maintenanceMessage,
  COMBAT_MAINTENANCE_MESSAGE,
} from '@/shared/combat/maintenance';

describe('combat maintenance gate', () => {
  it('opens combat only for the exact value "open"', () => {
    expect(parseCombatMode('open')).toBe('open');
  });

  it('fails closed for every other value', () => {
    for (const v of ['maintenance', 'Open', 'OPEN', '', ' open', 'legacy', 'shared', null, undefined, 0, 1, {}, []]) {
      expect(parseCombatMode(v)).toBe('maintenance');
    }
  });

  it('recognises a gated response', () => {
    expect(isMaintenanceResponse({ maintenance: true, combat_mode: 'maintenance' })).toBe(true);
  });

  it('does not mistake a resolved tick for a gated response', () => {
    expect(isMaintenanceResponse({ events: [], creature_states: [], encounter_tick: 12 })).toBe(false);
    expect(isMaintenanceResponse({ maintenance: false })).toBe(false);
    expect(isMaintenanceResponse(null)).toBe(false);
    expect(isMaintenanceResponse('maintenance')).toBe(false);
  });

  it('always yields a player-facing message', () => {
    expect(maintenanceMessage({ maintenance: true, message: 'Down for the forge.' })).toBe('Down for the forge.');
    expect(maintenanceMessage({ maintenance: true })).toBe(COMBAT_MAINTENANCE_MESSAGE);
    expect(maintenanceMessage(null)).toBe(COMBAT_MAINTENANCE_MESSAGE);
  });

  it('carries no events, no batch and no encounter identity when gated', async () => {
    const mod = await import('../../../supabase/functions/_shared/combat/maintenance.ts');
    const res = mod.maintenanceResponse();
    expect(res.maintenance).toBe(true);
    expect(res.events).toEqual([]);
    expect(res.creature_states).toEqual([]);
    expect(res.member_states).toEqual([]);
    expect(res.ticks_processed).toBe(0);
    expect(res.encounter_tick).toBeNull();
    expect(res.encounter_batch_id).toBeNull();
    expect(res.encounter_id).toBeNull();
  });

  it('fails closed when the config read errors, throws or the row is missing', async () => {
    const mod = await import('../../../supabase/functions/_shared/combat/maintenance.ts');
    const dbWith = (result: unknown) => ({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => result }),
        }),
      }),
    });
    expect(await mod.readCombatMode(dbWith({ data: null, error: null }))).toBe('maintenance');
    expect(await mod.readCombatMode(dbWith({ data: null, error: { message: 'boom' } }))).toBe('maintenance');
    expect(await mod.readCombatMode(dbWith({ data: { value: 'maintenance' }, error: null }))).toBe('maintenance');
    expect(await mod.readCombatMode(dbWith({ data: { value: 'open' }, error: null }))).toBe('open');
    const throwingDb = { from: () => { throw new Error('no connection'); } };
    expect(await mod.readCombatMode(throwingDb)).toBe('maintenance');
  });
});
