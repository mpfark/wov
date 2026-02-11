import { Character } from '@/hooks/useCharacter';
import { RACE_LABELS, CLASS_LABELS, STAT_LABELS, getStatModifier } from '@/lib/game-data';

interface Props {
  character: Character;
}

export default function CharacterPanel({ character }: Props) {
  const hpPercent = Math.round((character.hp / character.max_hp) * 100);
  const xpForNext = character.level * 100;
  const xpPercent = Math.round((character.xp / xpForNext) * 100);

  return (
    <div className="h-full flex flex-col p-3 space-y-3 overflow-y-auto">
      {/* Name & Identity */}
      <div className="text-center">
        <h2 className="font-display text-lg text-primary text-glow">{character.name}</h2>
        <p className="text-xs text-muted-foreground">
          {RACE_LABELS[character.race]} {CLASS_LABELS[character.class]} — Lvl {character.level}
        </p>
      </div>

      {/* HP Bar */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">HP</span>
          <span className="text-blood">{character.hp}/{character.max_hp}</span>
        </div>
        <div className="h-2 bg-background rounded-full overflow-hidden border border-border">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${hpPercent}%`,
              background: hpPercent > 50 ? 'hsl(var(--elvish))' : hpPercent > 25 ? 'hsl(var(--gold))' : 'hsl(var(--blood))',
            }}
          />
        </div>
      </div>

      {/* XP Bar */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">XP</span>
          <span className="text-primary">{character.xp}/{xpForNext}</span>
        </div>
        <div className="h-1.5 bg-background rounded-full overflow-hidden border border-border">
          <div className="h-full bg-primary transition-all duration-500" style={{ width: `${xpPercent}%` }} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-1.5">
        {Object.entries(STAT_LABELS).map(([key, label]) => {
          const val = (character as any)[key] as number;
          const mod = getStatModifier(val);
          return (
            <div key={key} className="text-center p-1.5 bg-background/50 rounded border border-border">
              <div className="text-[10px] text-muted-foreground">{label}</div>
              <div className="text-sm font-display text-foreground">{val}</div>
              <div className="text-[10px] text-primary">{mod >= 0 ? `+${mod}` : mod}</div>
            </div>
          );
        })}
      </div>

      {/* AC & Gold */}
      <div className="flex justify-around text-center">
        <div>
          <div className="text-[10px] text-muted-foreground">AC</div>
          <div className="font-display text-foreground">{character.ac}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">Gold</div>
          <div className="font-display text-primary">{character.gold}</div>
        </div>
      </div>

      {/* Equipment Slots */}
      <div>
        <h3 className="font-display text-xs text-muted-foreground mb-1.5">Equipment</h3>
        <div className="grid grid-cols-3 gap-1">
          {['head', 'amulet', 'shoulders', 'chest', 'gloves', 'belt', 'pants', 'ring', 'trinket'].map(slot => (
            <div key={slot} className="p-1.5 border border-border rounded bg-background/30 text-center">
              <div className="text-[9px] text-muted-foreground capitalize">{slot}</div>
              <div className="text-[10px] text-muted-foreground/50">Empty</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
