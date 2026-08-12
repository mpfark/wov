/**
 * tick-commit.ts — B2: the single-transaction tick state payload.
 *
 * The resolver no longer fires its tail writes as ~15 sequential statements.
 * It accumulates them into one `TickState` object which `commit_encounter_tick`
 * applies inside the token-gated transaction that also retires the durable
 * intents, publishes the result batch and advances the encounter cursor.
 *
 * Consequences:
 * - no partial ticks: a resolver that dies before commit writes nothing;
 * - no cadence drift: the cursor is anchored to the actual commit time;
 * - one round trip instead of many, which is where the per-tick latency went.
 *
 * `applyTickStateFallback` performs the exact same writes the legacy way and is
 * used only when the commit is refused (no encounter, stale claim, already
 * committed) so a refused tick can never silently drop its results.
 */

export interface TickCharacterWrite {
  id: string;
  /** Direct column patch (xp, level, gold, bhp, stance_state, …). */
  patch: Record<string, unknown>;
  /** Applied through the encounter delta helpers so writers can't lose updates. */
  hp_delta?: number;
  cp_delta?: number;
  mp_delta?: number;
}

export interface TickState {
  characters: TickCharacterWrite[];
  materials: { character_id: string; key: string; delta: number }[];
  contracts: { character_id: string; new_count: number }[];
  bond_kills: { character_id: string; creature_level: number; is_boss: boolean }[];
  effects_upsert: Record<string, unknown>[];
  effects_delete_ids: string[];
  effects_delete_targets: string[];
  item_buff_expire_before?: number;
  engagements_join: { character_id: string; creature_id: string }[];
  engagements_purge_creature_ids: string[];
  session?: {
    id: string;
    ended: boolean;
    last_tick_at?: number;
    engaged_creature_ids?: string[];
    member_buffs?: Record<string, unknown>;
    node_id?: string;
    recent_member_ids?: Record<string, unknown>;
  };
}

export function createTickState(): TickState {
  return {
    characters: [],
    materials: [],
    contracts: [],
    bond_kills: [],
    effects_upsert: [],
    effects_delete_ids: [],
    effects_delete_targets: [],
    engagements_join: [],
    engagements_purge_creature_ids: [],
  };
}

/** Legacy per-write application — only for a refused commit. */
export async function applyTickStateFallback(db: any, state: TickState): Promise<void> {
  const fail = (label: string) => (r: any) => {
    if (r?.error) console.warn(`[tick-commit fallback] ${label} failed`, r.error.message);
  };

  for (const c of state.characters) {
    const calls: Promise<any>[] = [];
    if (Object.keys(c.patch).length > 0) {
      calls.push(db.from('characters').update(c.patch).eq('id', c.id).then(fail('character patch')));
    }
    if (c.hp_delta && c.hp_delta < 0) {
      calls.push(db.rpc('encounter_apply_character_damage', {
        _character_id: c.id, _amount: -c.hp_delta,
        _source_kind: 'combat-tick', _source_creature_id: null,
      }).then(fail('hp damage')));
    } else if (c.hp_delta && c.hp_delta > 0) {
      calls.push(db.rpc('encounter_apply_character_heal', {
        _character_id: c.id, _amount: c.hp_delta, _source_kind: 'combat-tick',
      }).then(fail('hp heal')));
    }
    for (const [res, delta] of [['cp', c.cp_delta], ['mp', c.mp_delta]] as const) {
      if (delta) {
        calls.push(db.rpc('encounter_apply_character_resource', {
          _character_id: c.id, _resource: res, _delta: delta, _source_kind: 'combat-tick',
        }).then(fail(`${res} delta`)));
      }
    }
    await Promise.all(calls);
  }

  await Promise.all([
    ...state.materials.map(m =>
      db.rpc('add_material', { _character_id: m.character_id, _key: m.key, _delta: m.delta })
        .then(fail('add_material'))),
    ...state.contracts.map(c =>
      db.rpc('apply_contract_complete', { _character_id: c.character_id, _new_count: c.new_count })
        .then(fail('contract'))),
    ...state.bond_kills.map(b =>
      db.rpc('award_class_bond_for_kill', {
        _character_id: b.character_id, _creature_level: b.creature_level, _is_boss: b.is_boss,
      }).then(fail('bond'))),
  ]);

  if (state.effects_delete_targets.length > 0) {
    await db.from('active_effects').delete().in('target_id', state.effects_delete_targets);
  }
  if (state.effects_delete_ids.length > 0) {
    await db.from('active_effects').delete().in('id', state.effects_delete_ids);
  }
  if (state.item_buff_expire_before !== undefined) {
    await db.from('active_effects').delete()
      .like('effect_type', 'item_buff:%')
      .lte('expires_at', state.item_buff_expire_before);
  }
  if (state.effects_upsert.length > 0) {
    await db.from('active_effects')
      .upsert(state.effects_upsert, { onConflict: 'source_id,target_id,effect_type' });
  }

  await Promise.all([
    ...state.engagements_purge_creature_ids.map(id =>
      db.rpc('purge_creature_engagements', { _creature_id: id }).then(fail('engagement purge'))),
    ...state.engagements_join.map(w =>
      db.rpc('join_encounter_engagement', {
        _character_id: w.character_id, _creature_id: w.creature_id,
      }).then(fail('engagement join'))),
  ]);

  const s = state.session;
  if (s) {
    if (s.ended) {
      await db.from('combat_sessions').delete().eq('id', s.id);
    } else {
      await db.from('combat_sessions').update({
        last_tick_at: s.last_tick_at,
        engaged_creature_ids: s.engaged_creature_ids,
        member_buffs: s.member_buffs,
        node_id: s.node_id,
        recent_member_ids: s.recent_member_ids,
      }).eq('id', s.id);
    }
  }
}
