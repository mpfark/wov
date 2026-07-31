/**
 * ClassConfigManager — Phase 3 admin editor for class lifecycle & tuning.
 *
 * Edits rows of the `classes` table (presentation, base HP/AC, crit range,
 * every-3-levels bonuses, weapon proficiencies, autoattack profile) and owns
 * the lifecycle: draft → active → retired plus class-hall selectability.
 *
 * All saves run through the pure checks in `@/shared/formulas/class-validate`
 * so a class can never be published with values that would break combat math,
 * and a class that still has living characters can never be retired.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, Loader2, Save, ShieldCheck } from 'lucide-react';
import {
  CLASS_STAT_KEYS, CLASS_STATUSES, WEAPON_TAGS, validateClassConfig,
  validateClassLifecycle, type ClassConfigDraft,
} from '@/shared/formulas/class-validate';

interface RoleRow { id: string; class_key: string; slot: number; name: string }
interface AssignmentRow { class_key: string; role_id: string; status: string }

export default function ClassConfigManager() {
  const [rows, setRows] = useState<ClassConfigDraft[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<ClassConfigDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [classRes, roleRes, assignRes, charRes] = await Promise.all([
      supabase.from('classes').select('*').order('sort_order'),
      supabase.from('class_ability_roles').select('id, class_key, slot, name'),
      supabase.from('class_ability_assignments').select('class_key, role_id, status'),
      supabase.from('characters').select('class'),
    ]);
    setLoading(false);

    if (classRes.error) { toast.error(classRes.error.message); return; }

    const mapped: ClassConfigDraft[] = (classRes.data ?? []).map(r => ({
      class_key: r.class_key,
      label: r.label ?? '',
      icon: r.icon ?? '',
      color: r.color ?? '',
      description: r.description ?? '',
      status: r.status ?? 'active',
      is_pre_class: !!r.is_pre_class,
      is_selectable: !!r.is_selectable,
      sort_order: r.sort_order ?? 0,
      base_hp: r.base_hp ?? 18,
      base_ac: r.base_ac ?? 10,
      crit_range: r.crit_range ?? 20,
      level_bonuses: (r.level_bonuses as Record<string, number>) ?? {},
      weapon_proficiencies: (r.weapon_proficiencies as string[]) ?? [],
      autoattack: (r.autoattack as ClassConfigDraft['autoattack']) ?? {},
    }));
    setRows(mapped);
    setRoles((roleRes.data as RoleRow[]) ?? []);
    setAssignments((assignRes.data as AssignmentRow[]) ?? []);

    const tally: Record<string, number> = {};
    for (const c of charRes.data ?? []) {
      tally[(c as { class: string }).class] = (tally[(c as { class: string }).class] ?? 0) + 1;
    }
    setCounts(tally);
  }, []);

  useEffect(() => { load(); }, [load]);

  const select = (row: ClassConfigDraft) => {
    setSelectedKey(row.class_key);
    setDraft({
      ...row,
      level_bonuses: { ...row.level_bonuses },
      weapon_proficiencies: [...row.weapon_proficiencies],
      autoattack: { ...row.autoattack },
    });
  };

  const abilityGaps = useMemo(() => {
    if (!draft) return 0;
    const classRoles = roles.filter(r => r.class_key === draft.class_key);
    const published = new Set(
      assignments.filter(a => a.class_key === draft.class_key && a.status === 'active').map(a => a.role_id),
    );
    return classRoles.filter(r => !published.has(r.id)).length;
  }, [draft, roles, assignments]);

  const liveCharacters = draft ? (counts[draft.class_key] ?? 0) : 0;

  const validation = useMemo(() => {
    if (!draft) return { errors: [], warnings: [] };
    const config = validateClassConfig(draft);
    const lifecycle = validateClassLifecycle({
      nextStatus: draft.status,
      nextSelectable: draft.is_selectable,
      isPreClass: draft.is_pre_class,
      liveCharacters,
      abilityGaps,
    });
    return {
      errors: [...config.errors, ...lifecycle.errors],
      warnings: [...config.warnings, ...lifecycle.warnings],
    };
  }, [draft, liveCharacters, abilityGaps]);

  const save = async () => {
    if (!draft) return;
    if (validation.errors.length) { toast.error(validation.errors[0]); return; }
    setSaving(true);
    const { error } = await supabase.from('classes').update({
      label: draft.label,
      icon: draft.icon ?? '',
      color: draft.color ?? '',
      description: draft.description ?? '',
      status: draft.status,
      is_selectable: draft.is_selectable,
      sort_order: draft.sort_order,
      base_hp: draft.base_hp,
      base_ac: draft.base_ac,
      crit_range: draft.crit_range,
      level_bonuses: draft.level_bonuses as never,
      weapon_proficiencies: draft.weapon_proficiencies,
      autoattack: draft.autoattack as never,
    }).eq('class_key', draft.class_key);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${draft.label} saved — players pick it up on next reload.`);
    await load();
  };

  const toggleProf = (tag: string) => {
    if (!draft) return;
    const has = draft.weapon_proficiencies.includes(tag);
    setDraft({
      ...draft,
      weapon_proficiencies: has
        ? draft.weapon_proficiencies.filter(t => t !== tag)
        : [...draft.weapon_proficiencies, tag],
    });
  };

  return (
    <div className="h-full flex overflow-hidden">
      {/* Class list */}
      <div className="w-64 shrink-0 border-r border-border min-h-0">
        <ScrollArea className="h-full">
          <div className="p-3 space-y-1">
            {loading && (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading classes…
              </p>
            )}
            {rows.map(row => (
              <button
                key={row.class_key}
                onClick={() => select(row)}
                className={`w-full text-left px-2 py-1.5 rounded border text-xs transition-colors ${
                  selectedKey === row.class_key
                    ? 'border-primary bg-primary/10'
                    : 'border-border/60 hover:bg-muted/40'
                }`}
              >
                <span className="mr-1">{row.icon}</span>
                {row.label}
                <Badge
                  variant={row.status === 'active' ? 'secondary' : 'outline'}
                  className="ml-2 text-[9px] capitalize"
                >
                  {row.status}
                </Badge>
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {counts[row.class_key] ?? 0} chr
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          {!draft ? (
            <p className="p-6 text-sm text-muted-foreground">
              Select a class to edit its lifecycle, base stats and autoattack profile.
            </p>
          ) : (
            <div className="p-4 space-y-4 max-w-3xl">
              {/* Lifecycle */}
              <Card className="bg-card/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display flex items-center gap-2">
                    <span className="text-lg">{draft.icon}</span>{draft.label}
                    <Badge variant="outline" className="text-[10px] font-mono">{draft.class_key}</Badge>
                    {draft.is_pre_class && <Badge variant="secondary" className="text-[10px]">pre-class</Badge>}
                    <Badge variant="outline" className="ml-auto text-[10px]">
                      {liveCharacters} character(s) · {abilityGaps} empty slot(s)
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-4 gap-3">
                    <div className="col-span-2 space-y-1">
                      <Label className="text-[11px]">Label</Label>
                      <Input value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Icon</Label>
                      <Input value={draft.icon ?? ''} onChange={e => setDraft({ ...draft, icon: e.target.value })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Sort order</Label>
                      <Input type="number" value={draft.sort_order} onChange={e => setDraft({ ...draft, sort_order: Number(e.target.value) })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Status</Label>
                      <Select value={draft.status} onValueChange={v => setDraft({ ...draft, status: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CLASS_STATUSES.map(s => (
                            <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2 flex items-center gap-2 pt-5">
                      <Switch
                        checked={draft.is_selectable}
                        onCheckedChange={v => setDraft({ ...draft, is_selectable: v })}
                        disabled={draft.is_pre_class}
                      />
                      <Label className="text-[11px]">Offered in class halls</Label>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Color token</Label>
                      <Input value={draft.color ?? ''} onChange={e => setDraft({ ...draft, color: e.target.value })} className="h-8 text-xs" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Description</Label>
                    <Textarea value={draft.description ?? ''} rows={2} onChange={e => setDraft({ ...draft, description: e.target.value })} className="text-xs" />
                  </div>
                </CardContent>
              </Card>

              {/* Combat baseline */}
              <Card className="bg-card/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display">Combat baseline</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[11px]">Base HP</Label>
                      <Input type="number" value={draft.base_hp} onChange={e => setDraft({ ...draft, base_hp: Number(e.target.value) })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Base AC</Label>
                      <Input type="number" value={draft.base_ac} onChange={e => setDraft({ ...draft, base_ac: Number(e.target.value) })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Crit range (nat ≥)</Label>
                      <Input type="number" value={draft.crit_range} onChange={e => setDraft({ ...draft, crit_range: Number(e.target.value) })} className="h-8 text-xs" />
                    </div>
                  </div>

                  <div>
                    <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Attribute bonuses every 3 levels
                    </Label>
                    <div className="grid grid-cols-6 gap-2 mt-1">
                      {CLASS_STAT_KEYS.map(stat => (
                        <div key={stat} className="space-y-1">
                          <div className="text-[10px] text-center text-muted-foreground uppercase">{stat}</div>
                          <Input
                            type="number"
                            value={draft.level_bonuses[stat] ?? 0}
                            onChange={e => setDraft({
                              ...draft,
                              level_bonuses: { ...draft.level_bonuses, [stat]: Number(e.target.value) },
                            })}
                            className="h-8 text-xs text-center"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Weapon proficiencies (+1 hit, +10% damage)
                    </Label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {WEAPON_TAGS.map(tag => {
                        const active = draft.weapon_proficiencies.includes(tag);
                        return (
                          <Button
                            key={tag}
                            size="sm"
                            variant={active ? 'default' : 'outline'}
                            className="h-7 text-[11px] capitalize"
                            onClick={() => toggleProf(tag)}
                          >
                            {tag}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Autoattack */}
              <Card className="bg-card/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display">Autoattack profile</CardTitle>
                  <p className="text-[10px] text-muted-foreground">
                    Damage itself is weapon-based; the dice range is only used by the legacy
                    multi-attack, execute and ignite-consume mechanics.
                  </p>
                </CardHeader>
                <CardContent className="grid grid-cols-4 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-[11px]">Label</Label>
                    <Input value={draft.autoattack.label ?? ''} onChange={e => setDraft({ ...draft, autoattack: { ...draft.autoattack, label: e.target.value } })} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Emoji</Label>
                    <Input value={draft.autoattack.emoji ?? ''} onChange={e => setDraft({ ...draft, autoattack: { ...draft.autoattack, emoji: e.target.value } })} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Flavor stat</Label>
                    <Select
                      value={draft.autoattack.stat ?? ''}
                      onValueChange={v => setDraft({ ...draft, autoattack: { ...draft.autoattack, stat: v } })}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        {CLASS_STAT_KEYS.map(s => (
                          <SelectItem key={s} value={s} className="text-xs uppercase">{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Dice min</Label>
                    <Input type="number" value={draft.autoattack.diceMin ?? 1} onChange={e => setDraft({ ...draft, autoattack: { ...draft.autoattack, diceMin: Number(e.target.value) } })} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Dice max</Label>
                    <Input type="number" value={draft.autoattack.diceMax ?? 6} onChange={e => setDraft({ ...draft, autoattack: { ...draft.autoattack, diceMax: Number(e.target.value) } })} className="h-8 text-xs" />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-[11px]">Third-person verb</Label>
                    <Input value={draft.autoattack.verb ?? ''} onChange={e => setDraft({ ...draft, autoattack: { ...draft.autoattack, verb: e.target.value } })} className="h-8 text-xs" />
                  </div>
                  <div className="col-span-4 space-y-1">
                    <Label className="text-[11px]">Self verb (own log)</Label>
                    <Input value={draft.autoattack.selfVerb ?? ''} onChange={e => setDraft({ ...draft, autoattack: { ...draft.autoattack, selfVerb: e.target.value } })} className="h-8 text-xs" />
                  </div>
                </CardContent>
              </Card>

              {/* Validation */}
              <Card className="bg-card/80">
                <CardContent className="pt-4 space-y-1.5">
                  {validation.errors.length === 0 && validation.warnings.length === 0 && (
                    <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" /> Configuration is valid.
                    </p>
                  )}
                  {validation.errors.map(err => (
                    <p key={err} className="text-xs text-destructive flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {err}
                    </p>
                  ))}
                  {validation.warnings.map(warn => (
                    <p key={warn} className="text-xs text-amber-400 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {warn}
                    </p>
                  ))}
                </CardContent>
              </Card>

              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={saving || validation.errors.length > 0}>
                  {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                  Save class
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { const row = rows.find(r => r.class_key === selectedKey); if (row) select(row); }}
                >
                  Reset
                </Button>
              </div>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
