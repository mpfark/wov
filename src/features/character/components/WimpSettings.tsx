import { useState, useEffect } from 'react';
import { Character } from '@/features/character';
import { Button } from '@/components/ui/button';
import { useGameContext } from '@/contexts/GameContext';

interface Props {
  character: Character;
}

const DIRECTIONS = [
  { value: '', label: 'Disabled' },
  { value: 'N', label: 'North' },
  { value: 'NE', label: 'Northeast' },
  { value: 'E', label: 'East' },
  { value: 'SE', label: 'Southeast' },
  { value: 'S', label: 'South' },
  { value: 'SW', label: 'Southwest' },
  { value: 'W', label: 'West' },
  { value: 'NW', label: 'Northwest' },
];

/**
 * Lets the player configure an auto-flee threshold: when HP drops below the
 * chosen % of max HP during combat, the client triggers a flee move in the
 * chosen compass direction.
 */
export default function WimpSettings({ character }: Props) {
  const { updateCharacter } = useGameContext();
  const [threshold, setThreshold] = useState<number>(character.wimp_hp_threshold ?? 0);
  const [direction, setDirection] = useState<string>(character.wimp_direction ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setThreshold(character.wimp_hp_threshold ?? 0);
    setDirection(character.wimp_direction ?? '');
  }, [character.id, character.wimp_hp_threshold, character.wimp_direction]);

  const dirty =
    (character.wimp_hp_threshold ?? 0) !== threshold ||
    (character.wimp_direction ?? '') !== direction;

  const enabled = threshold > 0 && !!direction;

  const save = async () => {
    setSaving(true);
    try {
      await updateCharacter({
        wimp_hp_threshold: threshold,
        wimp_direction: direction || null,
      } as Partial<Character>);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="gap-row pt-2 border-t border-border/40">
      <div className="flex items-center justify-between">
        <span className="t-display-sm text-primary">⚠️ Wimp (auto-flee)</span>
        <span className={`t-meta ${enabled ? 'text-elvish' : 'text-muted-foreground'}`}>
          {enabled ? 'Active' : 'Off'}
        </span>
      </div>
      <p className="t-meta text-muted-foreground">
        Automatically flee combat once your HP drops below the chosen %.
      </p>

      <label className="flex items-center justify-between gap-2 mt-1">
        <span className="t-label text-[10px]">HP Threshold</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={100}
            value={threshold}
            onChange={e => {
              const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
              setThreshold(v);
            }}
            className="w-14 h-6 px-1 text-xs bg-surface-3/60 border border-border rounded text-right t-numeric"
          />
          <span className="t-meta">%</span>
        </div>
      </label>

      <label className="flex items-center justify-between gap-2">
        <span className="t-label text-[10px]">Flee Direction</span>
        <select
          value={direction}
          onChange={e => setDirection(e.target.value)}
          className="h-6 px-1 text-xs bg-surface-3/60 border border-border rounded"
        >
          {DIRECTIONS.map(d => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
      </label>

      <Button
        size="sm"
        variant="outline"
        className="h-6 w-full text-[10px]"
        disabled={!dirty || saving}
        onClick={save}
      >
        {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
      </Button>
    </div>
  );
}
