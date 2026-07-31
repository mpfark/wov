/**
 * useAbilityLoadout — Phase 4: per-character ability choices.
 *
 * Reads `character_ability_loadout` for the active character and applies the
 * selections through `applyAbilityLoadout`, so the ability bar, combat driver
 * and magnitude resolvers all pick up the chosen alternatives with no consumer
 * change. Selecting the class default deletes the row rather than storing it.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  applyAbilityLoadout, getLoadoutRoles, getRolesWithAlternatives, type LoadoutRole,
} from '@/features/combat/utils/ability-loadout';

export interface AbilityLoadoutState {
  /** Roles that offer a real choice (more than one active option). */
  roles: LoadoutRole[];
  /** role_id -> ability_id for the current character. */
  selections: Record<string, string>;
  loading: boolean;
  saving: boolean;
  error: string | null;
  select: (roleId: string, abilityId: string) => Promise<void>;
}

export function useAbilityLoadout(
  characterId: string | undefined,
  classKey: string | undefined,
  registryLoaded = true,
): AbilityLoadoutState {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roles = classKey ? getRolesWithAlternatives(classKey) : [];

  useEffect(() => {
    if (!characterId || !classKey) return;
    const roleIds = getLoadoutRoles(classKey).map(r => r.roleId);
    if (roleIds.length === 0) return;

    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error: err } = await supabase
        .from('character_ability_loadout')
        .select('role_id, ability_id')
        .eq('character_id', characterId)
        .in('role_id', roleIds);
      if (cancelled) return;
      setLoading(false);
      if (err) {
        setError(err.message);
        return;
      }
      const map: Record<string, string> = {};
      for (const row of data ?? []) map[row.role_id] = row.ability_id;
      setSelections(map);
      applyAbilityLoadout(classKey, map);
    })();

    return () => { cancelled = true; };
    // registryLoaded gates the first run until options exist.
  }, [characterId, classKey, registryLoaded]);

  const select = useCallback(async (roleId: string, abilityId: string) => {
    if (!characterId || !classKey) return;
    const role = getLoadoutRoles(classKey).find(r => r.roleId === roleId);
    const isDefault = role?.options.find(o => o.abilityId === abilityId)?.isDefault ?? false;

    const next = { ...selections };
    if (isDefault) delete next[roleId]; else next[roleId] = abilityId;

    // Optimistic: the bar updates immediately, the write follows.
    setSelections(next);
    applyAbilityLoadout(classKey, next);

    setSaving(true);
    setError(null);
    const { error: err } = isDefault
      ? await supabase.from('character_ability_loadout').delete()
          .eq('character_id', characterId).eq('role_id', roleId)
      : await supabase.from('character_ability_loadout')
          .upsert({ character_id: characterId, role_id: roleId, ability_id: abilityId },
                   { onConflict: 'character_id,role_id' });
    setSaving(false);
    if (err) {
      setError(err.message);
      setSelections(selections);
      applyAbilityLoadout(classKey, selections);
    }
  }, [characterId, classKey, selections]);

  return { roles, selections, loading, saving, error, select };
}
