/**
 * OnHitEffectEditor — the ONE admin surface for a class assignment's optional
 * On-Hit Effect (`class_ability_assignments.overrides.on_hit_effect`).
 *
 * The base ability decides WHICH effects are offered (`base_abilities.on_hit_allowed`,
 * mirrored onto `abilities.effect_config.on_hit_allowed`);
 * this editor only picks one of them and tunes bounded numbers. Bounds mirror
 * `ON_HIT_BOUNDS` exactly, so the UI can never author a value the shared
 * validator or the SQL trigger would reject.
 */
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ON_HIT_EFFECTS, ON_HIT_BOUNDS,
  type OnHitEffectConfig, type OnHitEffectKey,
} from '@/shared/combat/on-hit-effects';

interface Props {
  /** Effects the base ability permits — the authoritative allowlist. */
  allowed: OnHitEffectKey[];
  value: OnHitEffectConfig | null | undefined;
  onChange: (next: OnHitEffectConfig | null) => void;
}

const DEFAULTS = { chance_pct: 25, duration_ms: 6000, damage_per_tick: 3, max_stacks: 3 };

export function OnHitEffectEditor({ allowed, value, onChange }: Props) {

  if (allowed.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">On-hit effect</p>
        <p className="text-[11px] text-muted-foreground">
          The base ability does not declare any allowed on-hit effects, so none can be
          configured here. Add them to the base ability first.
        </p>
      </div>
    );
  }

  const patch = (part: Partial<OnHitEffectConfig>) => {
    const effect = (part.effect ?? value?.effect ?? allowed[0]) as OnHitEffectKey;
    onChange({
      effect,
      chance_pct: part.chance_pct ?? value?.chance_pct ?? DEFAULTS.chance_pct,
      duration_ms: part.duration_ms ?? value?.duration_ms ?? DEFAULTS.duration_ms,
      damage_per_tick: part.damage_per_tick ?? value?.damage_per_tick ?? DEFAULTS.damage_per_tick,
      max_stacks: part.max_stacks ?? value?.max_stacks ?? DEFAULTS.max_stacks,
    });
  };

  const num = (raw: string, min: number, max: number, current: number) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return current;
    return Math.min(max, Math.max(min, Math.round(n)));
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">On-hit effect</p>

      <div className="space-y-1">
        <Label className="text-[11px]">Effect</Label>
        <Select
          value={value?.effect ?? '__none'}
          onValueChange={v => (v === '__none' ? onChange(null) : patch({ effect: v as OnHitEffectKey }))}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none" className="text-xs">None</SelectItem>
            {allowed.map(k => (
              <SelectItem key={k} value={k} className="text-xs">
                {ON_HIT_EFFECTS[k].label} — {ON_HIT_EFFECTS[k].description}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[11px]">Chance %</Label>
            <Input
              type="number" className="h-8 text-xs"
              min={ON_HIT_BOUNDS.chance_pct.min} max={ON_HIT_BOUNDS.chance_pct.max}
              value={value.chance_pct}
              onChange={e => patch({
                chance_pct: num(e.target.value, ON_HIT_BOUNDS.chance_pct.min, ON_HIT_BOUNDS.chance_pct.max, value.chance_pct),
              })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Duration (ms)</Label>
            <Input
              type="number" className="h-8 text-xs" step={500}
              min={ON_HIT_BOUNDS.duration_ms.min} max={ON_HIT_BOUNDS.duration_ms.max}
              value={value.duration_ms}
              onChange={e => patch({
                duration_ms: num(e.target.value, ON_HIT_BOUNDS.duration_ms.min, ON_HIT_BOUNDS.duration_ms.max, value.duration_ms),
              })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Damage / tick</Label>
            <Input
              type="number" className="h-8 text-xs"
              min={ON_HIT_BOUNDS.damage_per_tick.min} max={ON_HIT_BOUNDS.damage_per_tick.max}
              value={value.damage_per_tick ?? 0}
              onChange={e => patch({
                damage_per_tick: num(e.target.value, ON_HIT_BOUNDS.damage_per_tick.min, ON_HIT_BOUNDS.damage_per_tick.max, value.damage_per_tick ?? 0),
              })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Max stacks</Label>
            <Input
              type="number" className="h-8 text-xs"
              min={ON_HIT_BOUNDS.max_stacks.min}
              max={Math.min(ON_HIT_BOUNDS.max_stacks.max, ON_HIT_EFFECTS[value.effect].stackCeiling)}
              value={value.max_stacks ?? 1}
              onChange={e => patch({
                max_stacks: num(
                  e.target.value, ON_HIT_BOUNDS.max_stacks.min,
                  Math.min(ON_HIT_BOUNDS.max_stacks.max, ON_HIT_EFFECTS[value.effect].stackCeiling),
                  value.max_stacks ?? 1,
                ),
              })}
            />
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Rolled server-side only after the ability lands damage — a miss never applies it.
      </p>
    </div>
  );
}
