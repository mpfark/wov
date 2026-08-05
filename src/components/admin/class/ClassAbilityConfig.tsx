/**
 * ClassAbilityConfig — the CLASS side of the ability system.
 *
 * Responsibility split (do not blur it again):
 *  - `AbilityConfigManager` owns the reusable BASE LIBRARY (`abilities`): key,
 *    mechanic, taxonomy, damage type, CP cost and the magnitude formulas.
 *  - This panel owns how a class USES a base ability: which slot it sits in,
 *    unlock level, assignment lifecycle, which entry is the slot default, and a
 *    narrow, validated per-class delta (`class_ability_assignments.overrides`).
 *
 * Overrides are intentionally narrow: text (label/description/tooltip/combat
 * text), mechanic tunables, and ATTRIBUTE-ONLY scaling swaps for terms the base
 * ability tagged `primary` / `secondary` (derived from the class's configured
 * attributes). Coefficients, curves, whole formulas, CP cost and identity stay
 * base-owned. Everything is validated through the ONE shared resolver, so what
 * the admin previews here is exactly what combat resolves.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import AbilityAssignPicker from './AbilityAssignPicker';
import EffectiveAbilityPreview from './EffectiveAbilityPreview';
import MechanicCalcsEditor from '../ability/MechanicCalcsEditor';
import { OnHitEffectEditor } from './OnHitEffectEditor';
import { type OnHitEffectConfig } from '@/shared/combat/on-hit-effects';
import { canRemoveAssignment, slotsWithBadDefaults } from './assignment-guard';
import {
  resolveEffectiveAbility, tagScalingRoles, taggedScalingRoles,
  validateAssignmentOverrides, CALC_STATS,
  type AssignmentOverrides, type BaseAbilityRow,
} from '@/shared/config/effective-ability';
import type { CalcStat } from '@/shared/formulas/ability-calc';


const ASSIGNMENT_STATUSES = ['draft', 'active', 'retired'] as const;
/** Combat-text slots an admin may author per class. */
const TEXT_SLOTS: { key: string; label: string }[] = [
  { key: 'cast', label: 'Cast line' },
  { key: 'hit', label: 'Hit line' },
];
/** Representative mid-game inputs used only to preview magnitudes in the editor. */
const PREVIEW_SAMPLE = {
  level: 20,
  mods: { str: 4, dex: 4, con: 4, int: 4, wis: 4, cha: 4 },
} as const;


interface RoleRow { id: string; class_key: string; slot: number; name: string; unlock_level: number }

interface AssignmentRow {
  id: string;
  role_id: string;
  slot: number;
  role_name: string;
  unlock_level: number;
  status: string;
  is_default: boolean;
  overrides: AssignmentOverrides;
  base: BaseAbilityRow & { id: string; status: string };
}

interface Props {
  classKey: string;
  classLabel: string;
  /** `classes.primary_attribute` — drives which terms carry the primary role. */
  primaryAttribute: string | null;
  /** `classes.secondary_attribute`. */
  secondaryAttribute: string | null;
}

export default function ClassAbilityConfig({
  classKey, classLabel, primaryAttribute, secondaryAttribute,
}: Props) {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AssignmentRow | null>(null);
  const [pickerRole, setPickerRole] = useState<RoleRow | null>(null);


  const load = useCallback(async () => {
    setLoading(true);
    const [roleRes, assignRes] = await Promise.all([
      supabase.from('class_ability_roles')
        .select('id, class_key, slot, name, unlock_level').eq('class_key', classKey),
      supabase.from('class_ability_assignments')
        .select(`
          id, role_id, unlock_level, status, is_default, overrides,
          role:class_ability_roles ( id, slot, name ),
          ability:abilities (
            id, ability_key, label, description, tooltip, mechanic_key, status,
            cp_cost, damage_type, amount_calc, duration_calc, interval_ms,
            mechanic_calcs, combat_text
          )
        `)
        .eq('class_key', classKey),
    ]);
    setLoading(false);
    if (assignRes.error) { toast.error(assignRes.error.message); return; }
    setRoles(((roleRes.data as RoleRow[]) ?? []).sort((a, b) => a.slot - b.slot));
    const mapped: AssignmentRow[] = (assignRes.data ?? [])
      .filter((r: any) => r.ability && r.role)
      .map((r: any) => ({
        id: r.id,
        role_id: r.role.id,
        slot: r.role.slot,
        role_name: r.role.name,
        unlock_level: r.unlock_level,
        status: r.status ?? 'active',
        is_default: !!r.is_default,
        overrides: (r.overrides ?? {}) as AssignmentOverrides,
        base: r.ability,
      }))
      .sort((a, b) => a.slot - b.slot || Number(b.is_default) - Number(a.is_default));
    setRows(mapped);
  }, [classKey]);

  useEffect(() => { load(); }, [load]);

  const open = (row: AssignmentRow) => {
    setOpenId(row.id);
    setDraft({ ...row, overrides: { ...row.overrides } });
  };

  /** Base ability with class-derived scaling roles tagged — the override target. */
  const taggedBase = useMemo(
    () => draft
      ? tagScalingRoles(draft.base, {
          primary: primaryAttribute as CalcStat | null,
          secondary: secondaryAttribute as CalcStat | null,
        })
      : null,
    [draft, primaryAttribute, secondaryAttribute],
  );

  const availableRoles = useMemo(
    () => (taggedBase ? taggedScalingRoles(taggedBase) : []),
    [taggedBase],
  );

  const preview = useMemo(
    () => (taggedBase && draft
      ? resolveEffectiveAbility(taggedBase, { overrides: draft.overrides })
      : null),
    [taggedBase, draft],
  );

  const errors = useMemo(
    () => (taggedBase && draft ? validateAssignmentOverrides(taggedBase, draft.overrides) : []),
    [taggedBase, draft],
  );

  const patchOverride = (key: keyof AssignmentOverrides, value: unknown) => {
    if (!draft) return;
    const next = { ...draft.overrides } as Record<string, unknown>;
    if (value === undefined || value === '' || (typeof value === 'object' && value !== null && Object.keys(value).length === 0)) {
      delete next[key as string];
    } else {
      next[key as string] = value;
    }
    setDraft({ ...draft, overrides: next as AssignmentOverrides });
  };

  const patchScaling = (role: 'primary' | 'secondary', attr: string) => {
    if (!draft) return;
    const key = role === 'primary' ? 'primary_attribute' : 'secondary_attribute';
    const scaling: Record<string, unknown> = { ...(draft.overrides.scaling ?? {}) };
    if (!attr) delete scaling[key]; else scaling[key] = attr;
    patchOverride('scaling', scaling);
  };

  const patchText = (slot: string, value: string) => {
    if (!draft) return;
    const text: Record<string, unknown> = { ...(draft.overrides.combat_text ?? {}) };
    if (!value.trim()) delete text[slot]; else text[slot] = value;
    patchOverride('combat_text', text);
  };

  const save = async () => {
    if (!draft) return;
    if (errors.length) { toast.error(errors[0]); return; }
    setSaving(true);
    const { error } = await supabase.from('class_ability_assignments').update({
      unlock_level: draft.unlock_level,
      status: draft.status,
      role_id: draft.role_id,
      overrides: draft.overrides as never,
    }).eq('id', draft.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${preview?.ability.label ?? draft.base.label} saved for ${classLabel}.`);
    await load();
  };
  const promoteDefault = async () => {
    if (!draft) return;
    setSaving(true);
    const { error } = await supabase.rpc('set_assignment_default' as any, { _assignment_id: draft.id });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${draft.base.label} is now the default for ${draft.role_name}.`);
    await load();
  };

  /** Safe unassign: never silently invalidates an equipped loadout or a slot default. */
  const removeAssignment = async (row: AssignmentRow) => {
    setSaving(true);
    const { count, error: countError } = await supabase
      .from('character_ability_loadout')
      .select('character_id', { count: 'exact', head: true })
      .eq('role_id', row.role_id)
      .eq('ability_id', row.base.id);
    if (countError) { setSaving(false); toast.error(countError.message); return; }

    const guard = canRemoveAssignment({
      isDefault: row.is_default,
      siblingCount: rows.filter(r => r.role_id === row.role_id && r.id !== row.id).length,
      equippedCount: count ?? 0,
    });
    if (!guard.ok) { setSaving(false); toast.error(guard.reason); return; }

    const { error } = await supabase.from('class_ability_assignments').delete().eq('id', row.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if (openId === row.id) { setOpenId(null); setDraft(null); }
    toast.success(`${row.base.label} unassigned from ${row.role_name}.`);
    await load();
  };

  const defaultIssues = useMemo(() => slotsWithBadDefaults(rows), [rows]);

  return (
    <Card className="bg-card/80">
      {pickerRole && (
        <AbilityAssignPicker
          open={!!pickerRole}
          onOpenChange={v => { if (!v) setPickerRole(null); }}
          classKey={classKey}
          classLabel={classLabel}
          roleId={pickerRole.id}
          roleName={pickerRole.name}
          roleSlot={pickerRole.slot}
          roleUnlockLevel={pickerRole.unlock_level}
          assignedAbilityIds={rows.filter(r => r.role_id === pickerRole.id).map(r => r.base.id)}
          slotHasDefault={rows.some(r => r.role_id === pickerRole.id && r.is_default)}
          onAssigned={load}
        />
      )}

      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-display">Ability configuration</CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Which base abilities {classLabel} uses, in which slot, and the narrow per-class delta.
          Formulas, CP cost and identity live in the ability library.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading assignments…
          </p>
        )}
        {defaultIssues.length > 0 && (
          <div className="rounded border border-destructive/50 bg-destructive/5 p-2 space-y-1">
            {defaultIssues.map(issue => {
              const role = roles.find(r => r.id === issue.role_id);
              return (
                <p key={issue.role_id} className="text-[11px] text-destructive flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                  Slot {role?.slot ?? '?'} · {role?.name ?? issue.role_id} has {issue.defaults} defaults —
                  every populated slot needs exactly one.
                </p>
              );
            })}
          </div>
        )}

        {roles.map(role => {
          const slotRows = rows.filter(r => r.role_id === role.id);
          return (
            <div key={role.id} className="rounded border border-border/60 p-2 space-y-1.5">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Slot {role.slot} · {role.name}
              </p>
              {slotRows.length === 0 && (
                <p className="text-[11px] text-muted-foreground">No ability assigned.</p>
              )}
              {slotRows.map(row => (
                <div key={row.id}>
                  <button
                    onClick={() => (openId === row.id ? (setOpenId(null), setDraft(null)) : open(row))}
                    className={`w-full text-left px-2 py-1.5 rounded border text-xs transition-colors ${
                      openId === row.id ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-muted/40'
                    }`}
                  >
                    {row.overrides.label ?? row.base.label}
                    <Badge variant="outline" className="ml-2 text-[9px]">L{row.unlock_level}</Badge>
                    {!row.is_default && (
                      <Badge variant="outline" className="ml-1 text-[9px] border-primary/50 text-primary">alt</Badge>
                    )}
                    {Object.keys(row.overrides).length > 0 && (
                      <Badge variant="secondary" className="ml-1 text-[9px]">overridden</Badge>
                    )}
                    {row.status !== 'active' && (
                      <Badge variant="secondary" className="ml-1 text-[9px] capitalize">{row.status}</Badge>
                    )}
                    <span className="ml-1 text-[10px] text-muted-foreground font-mono">{row.base.ability_key}</span>
                  </button>

                  {openId === row.id && draft && (
                    <div className="mt-2 space-y-3 rounded border border-border/60 bg-muted/20 p-3">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label className="text-[11px]">Unlock level</Label>
                          <Input
                            type="number" value={draft.unlock_level}
                            onChange={e => setDraft({ ...draft, unlock_level: Number(e.target.value) })}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Assignment status</Label>
                          <Select value={draft.status} onValueChange={v => setDraft({ ...draft, status: v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ASSIGNMENT_STATUSES.map(s => (
                                <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Slot</Label>
                          <Select value={draft.role_id} onValueChange={v => setDraft({ ...draft, role_id: v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {roles.map(r => (
                                <SelectItem key={r.id} value={r.id} className="text-xs">
                                  Slot {r.slot} · {r.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {!draft.is_default && (
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={saving} onClick={promoteDefault}>
                          Make default for {draft.role_name}
                        </Button>
                      )}

                      {/* Narrow per-class delta */}
                      <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Class overrides (blank = use the base ability)
                        </p>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Label</Label>
                          <Input
                            value={draft.overrides.label ?? ''}
                            placeholder={draft.base.label}
                            onChange={e => patchOverride('label', e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Description</Label>
                          <Textarea
                            rows={2}
                            value={draft.overrides.description ?? ''}
                            placeholder={draft.base.description}
                            onChange={e => patchOverride('description', e.target.value)}
                            className="text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Tooltip</Label>
                          <Input
                            value={draft.overrides.tooltip ?? ''}
                            placeholder={draft.base.tooltip}
                            onChange={e => patchOverride('tooltip', e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                        {TEXT_SLOTS.map(slot => (
                          <div key={slot.key} className="space-y-1">
                            <Label className="text-[11px]">{slot.label}</Label>
                            <Input
                              value={String(draft.overrides.combat_text?.[slot.key] ?? '')}
                              placeholder={String((draft.base.combat_text as any)?.[slot.key] ?? 'base / mechanic default')}
                              onChange={e => patchText(slot.key, e.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>
                        ))}
                      </div>

                      {/* Attribute-only scaling swaps */}
                      <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Scaling attributes
                        </p>
                        {availableRoles.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">
                            This ability has no term scaling off {classLabel}&apos;s primary or secondary
                            attribute, so there is nothing to retarget.
                          </p>
                        ) : (
                          <div className="grid grid-cols-2 gap-3">
                            {(['primary', 'secondary'] as const).filter(r => availableRoles.includes(r)).map(role => {
                              const key = role === 'primary' ? 'primary_attribute' : 'secondary_attribute';
                              const fallback = role === 'primary' ? primaryAttribute : secondaryAttribute;
                              return (
                                <div key={role} className="space-y-1">
                                  <Label className="text-[11px] capitalize">{role} scaling</Label>
                                  <Select
                                    value={draft.overrides.scaling?.[key] ?? '__base'}
                                    onValueChange={v => patchScaling(role, v === '__base' ? '' : v)}
                                  >
                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__base" className="text-xs">
                                        Base ({(fallback ?? '—').toUpperCase()})
                                      </SelectItem>
                                      {CALC_STATS.map(s => (
                                        <SelectItem key={s} value={s} className="text-xs uppercase">{s}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          Only the attribute is swapped — coefficients, curves and rounding stay
                          exactly as authored on the base ability.
                        </p>
                      </div>

                      {/* Optional On-Hit Effect (base-allowlisted, per class) */}
                      <OnHitEffectEditor
                        baseEffectConfig={draft.base.effect_config as Record<string, unknown> | null}
                        value={(draft.overrides as { on_hit_effect?: OnHitEffectConfig | null }).on_hit_effect ?? null}
                        onChange={next => patchOverride('on_hit_effect' as never, next as never)}
                      />

                      {/* Named mechanic parameters supported by this mechanic */}
                      <div className="space-y-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Mechanic tunables (per class)
                        </p>
                        <MechanicCalcsEditor
                          mechanicKey={draft.base.mechanic_key}
                          value={draft.overrides.mechanic_calcs ?? (draft.base.mechanic_calcs ?? {})}
                          onChange={next => patchOverride('mechanic_calcs', next)}
                          sample={PREVIEW_SAMPLE}
                        />
                      </div>

                      {preview && (
                        <EffectiveAbilityPreview
                          base={taggedBase ?? draft.base}
                          effective={preview.ability}
                          overriddenKeys={Object.keys(draft.overrides)}
                        />
                      )}

                      {errors.length > 0 && (
                        <div className="rounded border border-destructive/50 bg-destructive/5 p-2 space-y-1">
                          {errors.map(err => (
                            <p key={err} className="text-[11px] text-destructive flex items-start gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {err}
                            </p>
                          ))}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button size="sm" onClick={save} disabled={saving || errors.length > 0}>
                          {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                          Save assignment
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => open(row)}>Reset</Button>
                        <Button
                          size="sm" variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={saving}
                          onClick={() => removeAssignment(row)}
                        >
                          <Trash2 className="w-3 h-3 mr-1" /> Unassign
                        </Button>
                      </div>

                    </div>
                  )}
                </div>
              ))}

              <div className="flex gap-2">
                {slotRows.some(r => r.is_default) ? (
                  <Button
                    size="sm" variant="ghost" className="h-6 text-[10px] text-muted-foreground"
                    onClick={() => setPickerRole(role)}
                  >
                    <Plus className="w-3 h-3 mr-1" /> assign an alternative for {role.name}
                  </Button>
                ) : (
                  <Button
                    size="sm" variant="outline" className="h-7 text-[11px] border-dashed"
                    onClick={() => setPickerRole(role)}
                  >
                    <Plus className="w-3 h-3 mr-1" /> assign an ability to {role.name}
                  </Button>
                )}
              </div>

            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
